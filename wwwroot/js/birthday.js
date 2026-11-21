(() => {
    'use strict';

    const $ = id => document.getElementById(id);
    const cfg = window.BD;
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const store = {
        get(k) { try { return localStorage.getItem(k); } catch { return null; } },
        set(k, v) { try { localStorage.setItem(k, v); } catch { } }
    };
    const state = {
        name: cfg.name, greeting: cfg.greeting, target: new Date(cfg.dateIso),
        voiceFile: cfg.voiceFile, entered: false, soundOn: false, partyShown: false, live: false
    };

    const audio = $('bgAudio'), voice = $('bdVoice');
    const btnPlay = $('musicToggle'), btnSkip = $('musicSkip'), vol = $('musicVolume');
    const titleEl = $('musicTitle'), statusEl = $('musicStatus'), noteEl = $('musicNote');
    const titleOf = f => f.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const trackUrl = f => '/audio/' + encodeURIComponent(f);
    const voiceUrl = f => '/audio/voice/' + encodeURIComponent(f);
    const setStatus = t => { statusEl.textContent = t; };

    let playlist = [cfg.songFile], idx = 0, ducked = false;
    let baseVolume = parseFloat(store.get('bd-volume') ?? '0.7');
    if (!(baseVolume >= 0 && baseVolume <= 1)) baseVolume = 0.7;
    audio.volume = baseVolume;
    vol.value = baseVolume;

    const duck = on => { ducked = on; audio.volume = on ? baseVolume * 0.25 : baseVolume; };

    function syncPlayer() {
        const playing = !audio.paused;
        btnPlay.textContent = playing ? '⏸ Pause' : '▶ Play';
        btnPlay.setAttribute('aria-pressed', String(playing));
        noteEl.classList.toggle('spin', playing);
        setStatus(playing ? 'Now playing' : 'Paused');
    }

    function setTrack(i, autoplay) {
        const f = playlist[i];
        if (!f) return;
        idx = i;
        audio.src = trackUrl(f);
        titleEl.textContent = titleOf(f) + ' 🎵';
        if (autoplay) audio.play().catch(() => setStatus('Press play to start'));
        else syncPlayer();
    }

    async function refreshPlaylist(select) {
        try {
            const r = await fetch('/api/audio-list');
            if (r.ok) {
                const files = await r.json();
                if (Array.isArray(files) && files.length) {
                    const current = select || playlist[idx];
                    const i = files.indexOf(current);
                    playlist = files;
                    idx = i >= 0 ? i : 0;
                    if (i < 0 && audio.getAttribute('src')) setTrack(idx, !audio.paused); 
                }
            }
        } catch {  }
        btnSkip.hidden = playlist.length < 2;
        return playlist;
    }

    btnPlay.addEventListener('click', () => {
        if (audio.paused) audio.play().catch(() => setStatus('Playback was blocked'));
        else audio.pause();
    });
    btnSkip.addEventListener('click', async () => {
        const wasPlaying = !audio.paused;
        await refreshPlaylist();
        if (playlist.length > 1) setTrack((idx + 1) % playlist.length, wasPlaying);
    });
    vol.addEventListener('input', () => {
        baseVolume = parseFloat(vol.value);
        if (!ducked) audio.volume = baseVolume;
        store.set('bd-volume', String(baseVolume));
    });
    audio.addEventListener('play', syncPlayer);
    audio.addEventListener('pause', syncPlayer);
    audio.addEventListener('waiting', () => setStatus('Buffering…'));
    audio.addEventListener('error', () => { if (audio.getAttribute('src')) setStatus('⚠ Song file not found'); });
    audio.addEventListener('ended', async () => {
        await refreshPlaylist();
        setTrack((idx + 1) % playlist.length, true);
    });

    const badge = $('voiceBadge');
    const showBadge = t => { badge.textContent = t; badge.classList.remove('hidden'); };
    const hideBadge = () => badge.classList.add('hidden');
    const idleBadge = () => showBadge('🎤 Play the birthday voice again');
    let voicePlaying = false;

    function stopVoice() {
        voice.pause();
        voice.currentTime = 0;
        if (window.speechSynthesis) speechSynthesis.cancel();
        voicePlaying = false;
        idleBadge(); 
        duck(false); 
    }

    async function pickVoice() {
        try {
            const r = await fetch('/api/voice-list');
            if (r.ok) {
                const files = await r.json();
                if (Array.isArray(files) && files.length) {
                    state.voiceFile = files.length === 1 ? files[0] : files[Math.floor(Math.random() * files.length)];
                }
            }
        } catch { }
        setVoice(state.voiceFile);
    }

    function setVoice(file) {
        state.voiceFile = file;
        voice.pause();
        voice.src = voiceUrl(file);
        voice.load();
    }

    function speak() {
        if (!window.speechSynthesis) return;
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(`Happy Birthday, ${state.name}! Wishing you a wonderful day!`);
        u.rate = 0.9; u.pitch = 1.1;
        u.onend = () => { voicePlaying = false; idleBadge(); duck(false); };
        voicePlaying = true;
        showBadge('⏹ Tap to stop');
        speechSynthesis.speak(u);
    }

    async function playVoice(manual = false) {
        if (!state.soundOn && !manual) return;
        showBadge('⏹ Tap to stop');
        duck(true);
        voicePlaying = true;
        voice.onended = () => { voicePlaying = false; idleBadge(); duck(false); };
        try {
            voice.currentTime = 0;
            await voice.play();
        } catch (err) {
            voicePlaying = false;
            duck(false);
            if (err && err.name === 'NotAllowedError') showBadge('🔊 Tap here to hear your birthday message');
            else speak(); 
        }
    }
    badge.addEventListener('click', () => {
        if (voicePlaying) { stopVoice(); return; }   
        state.soundOn = true;                         
        playVoice(true);
    });

    function unlockVoice() {
        voice.muted = true;
        voice.play().then(() => { voice.pause(); voice.currentTime = 0; }).catch(() => { }).finally(() => { voice.muted = false; });
    }

    const gate = $('enterGate');
    function enter(withSound) {
        state.entered = true;
        state.soundOn = withSound;
        gate.classList.add('leaving');
        setTimeout(() => gate.remove(), 450);
        if (!withSound) return;
        if (state.partyShown && state.live) playVoice(); else unlockVoice();
        audio.play().catch(() => { });
    }
    $('enterBtn').addEventListener('click', () => enter(true));
    $('enterMute').addEventListener('click', () => enter(false));
    $('enterBtn').focus();

    /* ───────── Countdown ───────── */
    const el = { d: $('cdDays'), h: $('cdHours'), m: $('cdMinutes'), s: $('cdSeconds') };
    const pad = n => String(n).padStart(2, '0');
    const dateFmt = new Intl.DateTimeFormat(undefined, {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
    });
    let timer = null;

    function put(node, value) {
        const s = pad(value);
        if (node.textContent === s) return;
        node.textContent = s;
        if (!reduceMotion) { node.classList.remove('tick'); void node.offsetWidth; node.classList.add('tick'); }
    }

    function tick() {
        const diff = state.target - Date.now();
        if (diff <= 0) { showCelebration(); return; }
        const t = Math.floor(diff / 1000);
        put(el.d, Math.floor(t / 86400));
        put(el.h, Math.floor((t % 86400) / 3600));
        put(el.m, Math.floor((t % 3600) / 60));
        put(el.s, t % 60);
    }

    function setDateLabel() { $('targetDate').textContent = dateFmt.format(state.target); }

    function showCelebration() {
        clearInterval(timer);
        $('countdownSection').classList.add('hidden');
        const cel = $('celebrationSection');
        cel.classList.remove('hidden');
        document.body.dataset.mode = 'party';
        if (!state.partyShown) {
            state.partyShown = true;
            cel.classList.add('revealed');
            bg.burst();
            if (state.entered && state.live) playVoice(); 
        }
    }

    function startCountdown() {
        clearInterval(timer);
        if (state.target <= Date.now()) { state.live = false; showCelebration(); return; }
        state.live = true;
        state.partyShown = false;
        $('countdownSection').classList.remove('hidden');
        $('celebrationSection').classList.add('hidden');
        document.body.dataset.mode = 'countdown';
        tick();
        timer = setInterval(tick, 250);
    }

    const bg = (() => {
        const canvas = $('bgCanvas'), ctx = canvas.getContext('2d');
        const HUES = [42, 345, 190, 285, 150];
        let W, H, grad, stars = [], motes = [], fireworks = [], raf = 0;

        function resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            W = innerWidth; H = innerHeight;
            canvas.width = W * dpr; canvas.height = H * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            grad = ctx.createLinearGradient(0, 0, 0, H);
            grad.addColorStop(0, '#0b0d2a'); grad.addColorStop(.6, '#1b0f3d'); grad.addColorStop(1, '#3a1450');
            stars = Array.from({ length: W < 600 ? 60 : 120 }, () => ({
                x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.6 + .3,
                a: Math.random(), da: (Math.random() * .008 + .003) * (Math.random() < .5 ? 1 : -1)
            }));
            motes = Array.from({ length: W < 600 ? 25 : 50 }, () => newMote(true));
            if (reduceMotion) draw();
        }

        const newMote = init => ({
            x: Math.random() * W, y: init ? Math.random() * H : H + 20,
            r: Math.random() * 4 + 1.5, vy: -(Math.random() * .5 + .2), vx: (Math.random() - .5) * .4,
            hue: HUES[Math.floor(Math.random() * HUES.length)], a: Math.random() * .35 + .1
        });

        class Spark {
            constructor(x, y, hue) {
                const a = Math.random() * Math.PI * 2, s = Math.random() * 5 + 1.5;
                this.x = x; this.y = y; this.vx = Math.cos(a) * s; this.vy = Math.sin(a) * s;
                this.life = 1; this.decay = Math.random() * .025 + .012;
                this.r = Math.random() * 2.2 + .8; this.hue = hue + (Math.random() * 30 - 15);
            }
            update() { this.vx *= .96; this.vy = this.vy * .96 + .06; this.x += this.vx; this.y += this.vy; this.life -= this.decay; }
            draw() { ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, 6.283); ctx.fillStyle = `hsla(${this.hue},100%,68%,${this.life})`; ctx.fill(); }
        }

        class Firework {
            constructor() {
                this.x = Math.random() * W * .8 + W * .1; this.y = H;
                this.tx = Math.random() * W * .6 + W * .2; this.ty = Math.random() * H * .45 + H * .05;
                const dist = Math.hypot(this.tx - this.x, this.ty - this.y), spd = Math.random() * 4 + 8;
                this.vx = (this.tx - this.x) / dist * spd; this.vy = (this.ty - this.y) / dist * spd;
                this.hue = HUES[Math.floor(Math.random() * HUES.length)];
                this.exploded = false; this.sparks = [];
            }
            update() {
                if (!this.exploded) {
                    this.x += this.vx; this.y += this.vy;
                    if (Math.hypot(this.tx - this.x, this.ty - this.y) < Math.abs(this.vy) + 2) {
                        this.exploded = true;
                        for (let i = 0; i < 70; i++) this.sparks.push(new Spark(this.x, this.y, this.hue));
                    }
                } else {
                    this.sparks.forEach(s => s.update());
                    this.sparks = this.sparks.filter(s => s.life > 0);
                }
            }
            draw() {
                if (this.exploded) { this.sparks.forEach(s => s.draw()); return; }
                ctx.beginPath(); ctx.arc(this.x, this.y, 2.5, 0, 6.283);
                ctx.fillStyle = `hsl(${this.hue},100%,72%)`; ctx.fill();
            }
            get done() { return this.exploded && this.sparks.length === 0; }
        }

        function draw() {
            ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
            stars.forEach(s => {
                if (!reduceMotion) { s.a += s.da; if (s.a > 1 || s.a < 0) s.da *= -1; }
                ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.283);
                ctx.fillStyle = `rgba(255,255,255,${Math.max(0, Math.min(1, s.a))})`; ctx.fill();
            });
            if (reduceMotion) return;
            motes.forEach((m, i) => {
                m.x += m.vx; m.y += m.vy;
                if (m.y < -20) motes[i] = newMote(false);
                ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, 6.283);
                ctx.fillStyle = `hsla(${m.hue},90%,70%,${m.a})`; ctx.fill();
            });
            fireworks.forEach(f => { f.update(); f.draw(); });
            fireworks = fireworks.filter(f => !f.done);
        }

        function loop() { draw(); raf = requestAnimationFrame(loop); }

        function spawn() {
            if (!document.hidden && !reduceMotion) fireworks.push(new Firework());
            const party = document.body.dataset.mode === 'party';
            setTimeout(spawn, party ? Math.random() * 600 + 250 : Math.random() * 2500 + 2000);
        }

        window.addEventListener('resize', resize);
        document.addEventListener('visibilitychange', () => {
            cancelAnimationFrame(raf);
            if (!document.hidden && !reduceMotion) loop();
        });

        resize();
        if (!reduceMotion) { loop(); spawn(); }

        return {
            burst() {
                if (reduceMotion) return;
                for (let i = 0; i < 10; i++) setTimeout(() => fireworks.push(new Firework()), i * 150);
            }
        };
    })();

    (() => {
        const box = $('floatingEmojis');
        if (reduceMotion || !box) return;
        const calm = ['🎈', '✨', '⭐', '💫', '🎀', '🎊', '🌸', '🍀'];
        const party = ['🎉', '🎊', '🎂', '🎁', '🥳', '✨', '🎈', '🍰', '❤️'];
        function spawn() {
            if (document.hidden || box.childElementCount > 24) return;
            const pool = document.body.dataset.mode === 'party' ? party : calm;
            const e = document.createElement('span');
            const dur = Math.random() * 8 + 7;
            e.className = 'floating-emoji';
            e.textContent = pool[Math.floor(Math.random() * pool.length)];
            e.style.cssText = `left:${Math.random() * 100}vw;font-size:${Math.random() * 1.4 + 1.2}rem;animation:floatUp ${dur}s linear forwards;opacity:0`;
            box.appendChild(e);
            setTimeout(() => e.remove(), (dur + .5) * 1000);
        }
        setInterval(spawn, 800);
        for (let i = 0; i < 5; i++) setTimeout(spawn, i * 200);
    })();

    const frame = $('photoFrame');
    const layers = [...frame.querySelectorAll('img')];
    const photoUrl = f => '/images/birthday/' + encodeURIComponent(f);
    let photos = [], photoIdx = 0, front = 1, photoTimer = null;

    function showPhoto(i) {
        const next = layers[1 - front];
        next.onload = () => {
            next.classList.add('active');
            layers[front].classList.remove('active');
            front = 1 - front;
        };
        next.src = photoUrl(photos[i]);
    }

    function advancePhoto() {
        photoIdx = (photoIdx + 1) % photos.length;
        showPhoto(photoIdx);
    }

    async function refreshPhotos() {
        let files;
        try {
            const r = await fetch('/api/image-list');
            files = r.ok ? await r.json() : [];
        } catch { return; }

        clearInterval(photoTimer);
        const same = JSON.stringify(files) === JSON.stringify(photos);
        photos = Array.isArray(files) ? files : [];
        frame.classList.toggle('hidden', photos.length === 0);
        if (!photos.length) return;

        if (!same || !layers.some(l => l.classList.contains('active'))) { photoIdx = 0; showPhoto(0); }
        if (photos.length > 1) photoTimer = setInterval(() => { if (!document.hidden) advancePhoto(); }, 5000);
    }

    window.BDApp = {
        get: () => ({ name: state.name, greeting: state.greeting, dateIso: state.target.toISOString() }),
        refreshPlaylist,
        refreshPhotos,
        pickVoice,
        async playSong(file) {
            await refreshPlaylist(file);
            const i = playlist.indexOf(file);
            setTrack(i >= 0 ? i : idx, true);
        },
        setVoice,
        apply(d) {
            if (d.name) {
                state.name = d.name;
                document.querySelectorAll('.name-text').forEach(n => { n.textContent = d.name; });
                document.title = `🎂 Birthday countdown – ${d.name}`;
            }
            if (d.greeting) {
                state.greeting = d.greeting;
                const t = document.querySelector('.celebration-title');
                if (t) t.textContent = d.greeting;
            }
            if (d.birthdayDate) {
                const t = new Date(d.birthdayDate);
                if (+t !== +state.target) { state.target = t; setDateLabel(); startCountdown(); }
            }
            if (d.songUploaded && d.songFile) this.playSong(d.songFile);
            if (d.voiceUploaded && d.voiceFile) setVoice(d.voiceFile);
            if (d.imagesUploaded) refreshPhotos();
        }
    };

    setDateLabel();
    startCountdown();
    refreshPlaylist(cfg.songFile).then(() => setTrack(idx, false));
    pickVoice();
    refreshPhotos();
})();