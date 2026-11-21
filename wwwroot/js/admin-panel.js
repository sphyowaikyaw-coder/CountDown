
(() => {
    'use strict';

    const $ = id => document.getElementById(id);
    const app = window.BDApp;

    const overlay = $('adminOverlay'), trigger = $('adminTriggerBtn');
    const tabsBar = $('adminTabs');
    const tabs = [...document.querySelectorAll('.admin-tab')];
    const panes = [...document.querySelectorAll('.tab-pane')];
    const inpName = $('inp-name'), inpDate = $('inp-date'), inpMsg = $('inp-msg'), msgLen = $('msgLen');
    const inpSong = $('inp-song'), inpVoice = $('inp-voice'), inpPhotos = $('inp-photos');

    let pin = null, clicks = 0, clickTimer = null, lastFocus = null;
    let selectedSong = null, selectedVoice = null, selectedPhotos = [];
    const previewUrls = {};

    const api = (path, opts = {}) =>
        fetch(path, { ...opts, headers: { ...(opts.headers || {}), 'X-Admin-Pin': pin || '' } });

    const say = (text, isError = false) => {
        const m = $('adminMsg');
        m.textContent = text;
        m.classList.toggle('error', isError);
    };

    function toast(text) {
        const t = $('toast');
        t.textContent = text;
        t.classList.remove('hidden');
        clearTimeout(toast.t);
        toast.t = setTimeout(() => t.classList.add('hidden'), 2600);
    }

    const toLocalInput = d => new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

    function openModal() {
        lastFocus = document.activeElement;
        overlay.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        resetMedia();
        say('');
        if (pin) { fillPerson(); showTab('tab-person'); } else showTab('tab-lock');
    }

    function closeModal() {
        overlay.classList.add('hidden');
        document.body.style.overflow = '';
        lastFocus?.focus?.();
    }

    function showTab(id) {
        tabsBar.classList.toggle('hidden', id === 'tab-lock');
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === id));
        panes.forEach(p => p.classList.toggle('hidden', p.id !== id));
        if (id === 'tab-songs') loadLibrary();
        if (id === 'tab-photos') loadPhotos();
        const first = $(id).querySelector('input:not([type=file]), textarea, button');
        first?.focus();
    }

    function fillPerson() {
        const s = app.get();
        inpName.value = s.name;
        inpDate.value = toLocalInput(new Date(s.dateIso));
        inpMsg.value = s.greeting;
        msgLen.textContent = inpMsg.value.length;
    }

    trigger.addEventListener('click', () => {
        clicks++;
        clearTimeout(clickTimer);
        if (clicks >= 3) { clicks = 0; openModal(); }
        else clickTimer = setTimeout(() => { clicks = 0; }, 700);
    });

    $('adminCloseBtn').addEventListener('click', closeModal);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
    document.addEventListener('keydown', e => {
        if (overlay.classList.contains('hidden')) return;
        if (e.key === 'Escape') { closeModal(); return; }
        if (e.key === 'Tab') { 
            const f = [...overlay.querySelectorAll('button, input:not([type=file]), textarea, [tabindex="0"]')]
                .filter(n => !n.disabled && n.offsetParent !== null);
            if (!f.length) return;
            const first = f[0], last = f[f.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
    });
    document.querySelectorAll('.admin-form').forEach(f => f.addEventListener('submit', e => e.preventDefault()));

    $('tab-lock').addEventListener('submit', async () => {
        const entered = $('inp-pin').value;
        if (!entered) { say('Enter the PIN to continue.', true); return; }
        pin = entered;
        try {
            const r = await api('/api/admin/verify', { method: 'POST' });
            if (!r.ok) {
                pin = null;
                say(r.status === 401 ? 'That PIN is not correct.' : 'Could not check the PIN.', true);
                return;
            }
            $('inp-pin').value = '';
            say('');
            fillPerson();
            showTab('tab-person');
        } catch {
            pin = null;
            say('Network error. Check your connection and try again.', true);
        }
    });

    /* ───────── Tabs ───────── */
    tabs.forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));
    $('goToMediaTab').addEventListener('click', () => showTab('tab-media'));
    $('goToPersonTab').addEventListener('click', () => showTab('tab-person'));
    $('goToSongsTab').addEventListener('click', () => showTab('tab-photos'));
    $('goToMediaFromPhotos').addEventListener('click', () => showTab('tab-media'));
    $('goToSongsFromPhotos').addEventListener('click', () => showTab('tab-songs'));
    $('goToMediaTabFromSongs').addEventListener('click', () => showTab('tab-photos'));
    inpMsg.addEventListener('input', () => { msgLen.textContent = inpMsg.value.length; });

    /* ───────── File pickers ───────── */
    function bindDrop(dropId, input, previewId, wrapId, labelId, onFile) {
        const drop = $(dropId);
        const handle = file => {
            if (!file) return;
            if (!file.name.toLowerCase().endsWith('.mp3')) { say('Only .mp3 files are supported.', true); return; }
            if (file.size > 40 * 1024 * 1024) { say('That file is larger than 40 MB.', true); return; }
            say('');
            onFile(file);
            if (previewUrls[previewId]) URL.revokeObjectURL(previewUrls[previewId]);
            previewUrls[previewId] = URL.createObjectURL(file);
            $(previewId).src = previewUrls[previewId];
            $(labelId).textContent = file.name;
            $(wrapId).classList.remove('hidden');
        };
        drop.addEventListener('click', () => input.click());
        drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
        drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag-over'); });
        drop.addEventListener('dragleave', () => drop.classList.remove('drag-over'));
        drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('drag-over'); handle(e.dataTransfer.files[0]); });
        input.addEventListener('change', () => handle(input.files[0]));
    }
    bindDrop('songDrop', inpSong, 'songPreview', 'songPreviewWrap', 'songFileName', f => { selectedSong = f; });
    bindDrop('voiceDrop', inpVoice, 'voicePreview', 'voicePreviewWrap', 'voiceFileName', f => { selectedVoice = f; });

    function resetMedia() {
        selectedSong = selectedVoice = null;
        inpSong.value = inpVoice.value = '';
        ['songPreview', 'voicePreview'].forEach(id => {
            const a = $(id);
            a.pause(); a.removeAttribute('src'); a.load();
            if (previewUrls[id]) { URL.revokeObjectURL(previewUrls[id]); delete previewUrls[id]; }
        });
        $('songFileName').textContent = $('voiceFileName').textContent = '';
        $('songPreviewWrap').classList.add('hidden');
        $('voicePreviewWrap').classList.add('hidden');
        selectedPhotos = [];
        inpPhotos.value = '';
        $('photoPreviewGrid').replaceChildren();
    }

    const photoDrop = $('photoDrop');
    const isPhoto = f => /\.(jpe?g|png|webp|gif)$/i.test(f.name);

    function addPhotos(fileList) {
        const grid = $('photoPreviewGrid');
        for (const file of fileList) {
            if (!isPhoto(file)) { say(`${file.name} is not a JPG, PNG, WebP or GIF image.`, true); continue; }
            if (file.size > 8 * 1024 * 1024) { say(`${file.name} is larger than 8 MB.`, true); continue; }
            say('');
            selectedPhotos.push(file);

            const url = URL.createObjectURL(file);
            const img = document.createElement('img');
            img.alt = '';
            img.onload = () => URL.revokeObjectURL(url);
            img.src = url;

            const rm = document.createElement('button');
            rm.type = 'button';
            rm.textContent = '✕';
            rm.setAttribute('aria-label', `Do not add ${file.name}`);

            const cell = document.createElement('div');
            cell.className = 'thumb';
            rm.addEventListener('click', () => { selectedPhotos = selectedPhotos.filter(f => f !== file); cell.remove(); });
            cell.append(img, rm);
            grid.appendChild(cell);
        }
    }

    photoDrop.addEventListener('click', () => inpPhotos.click());
    photoDrop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inpPhotos.click(); } });
    photoDrop.addEventListener('dragover', e => { e.preventDefault(); photoDrop.classList.add('drag-over'); });
    photoDrop.addEventListener('dragleave', () => photoDrop.classList.remove('drag-over'));
    photoDrop.addEventListener('drop', e => { e.preventDefault(); photoDrop.classList.remove('drag-over'); addPhotos(e.dataTransfer.files); });
    inpPhotos.addEventListener('change', () => { addPhotos(inpPhotos.files); inpPhotos.value = ''; });

    async function loadPhotos() {
        const box = $('photoListContainer');
        const note = t => { const p = document.createElement('p'); p.className = 'thumb-empty'; p.textContent = t; box.replaceChildren(p); };
        note('Loading…');

        let files;
        try {
            const r = await fetch('/api/image-list');
            files = r.ok ? await r.json() : [];
        } catch { note('Could not load photos.'); return; }
        if (!files.length) { note('No photos yet.'); return; }

        box.replaceChildren();
        files.forEach(file => {
            const img = document.createElement('img');
            img.alt = '';
            img.loading = 'lazy';
            img.src = '/images/birthday/' + encodeURIComponent(file);

            const rm = document.createElement('button');
            rm.type = 'button';
            rm.textContent = '🗑';
            rm.setAttribute('aria-label', `Remove ${file}`);
            let armed = false;
            rm.addEventListener('click', async () => {
                if (!armed) { // second tap confirms
                    armed = true; rm.textContent = 'Sure?';
                    setTimeout(() => { if (!rm.disabled) { armed = false; rm.textContent = '🗑'; } }, 3000);
                    return;
                }
                rm.disabled = true;
                try {
                    const r = await api(`/api/image/${encodeURIComponent(file)}`, { method: 'DELETE' });
                    const d = await r.json().catch(() => ({}));
                    if (!r.ok) { say(d.message || `Could not remove ${file}.`, true); rm.disabled = false; armed = false; rm.textContent = '🗑'; return; }
                    await app.refreshPhotos();
                    await loadPhotos();
                    say('Photo removed.');
                } catch { say('Network error. Try again.', true); rm.disabled = false; armed = false; rm.textContent = '🗑'; }
            });

            const cell = document.createElement('div');
            cell.className = 'thumb';
            cell.append(img, rm);
            box.appendChild(cell);
        });
    }

    async function renderList(box, listUrl, deleteBase, emptyText, afterDelete) {
        box.textContent = 'Loading…';
        let files;
        try {
            const r = await fetch(listUrl);
            files = r.ok ? await r.json() : [];
        } catch { box.textContent = 'Could not load this list.'; return; }

        box.replaceChildren();
        if (!files.length) { box.textContent = emptyText; return; }

        files.forEach(file => {
            const row = document.createElement('div');
            row.className = 'song-list-item';
            const name = document.createElement('span');
            name.className = 'song-list-name';
            name.textContent = file;
            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'pill danger';
            del.textContent = 'Remove';
            let armed = false;

            del.addEventListener('click', async () => {
                if (!armed) { 
                    armed = true;
                    del.textContent = 'Tap again to confirm';
                    setTimeout(() => { if (!del.disabled) { armed = false; del.textContent = 'Remove'; } }, 3000);
                    return;
                }
                del.disabled = true;
                del.textContent = 'Removing…';
                try {
                    const r = await api(`${deleteBase}/${encodeURIComponent(file)}`, { method: 'DELETE' });
                    const d = await r.json().catch(() => ({}));
                    if (!r.ok) {
                        say(d.message || `Could not remove ${file}.`, true);
                        del.disabled = false; armed = false; del.textContent = 'Remove';
                        return;
                    }
                    await afterDelete();
                    await loadLibrary();
                    say(`${file} was removed.`);
                } catch {
                    say('Network error. Try again.', true);
                    del.disabled = false; armed = false; del.textContent = 'Remove';
                }
            });

            row.append(name, del);
            box.appendChild(row);
        });
    }

    function loadLibrary() {
        return Promise.all([
            renderList($('songListContainer'), '/api/audio-list', '/api/audio', 'No theme songs yet.', () => app.refreshPlaylist()),
            renderList($('voiceListContainer'), '/api/voice-list', '/api/voice', 'No voice greetings yet.', () => app.pickVoice())
        ]);
    }

    $('applySettingsBtn').addEventListener('click', async () => {
        const btn = $('applySettingsBtn');
        btn.disabled = true;
        btn.textContent = 'Saving…';
        say('');
        try {
            const fd = new FormData();
            if (inpName.value.trim()) fd.append('Name', inpName.value.trim());
            if (inpDate.value) {
                const d = new Date(inpDate.value);
                if (!isNaN(d)) fd.append('BirthdayDate', d.toISOString());
            }
            if (inpMsg.value.trim()) fd.append('Greeting', inpMsg.value.trim());
            if (selectedSong) fd.append('SongFile', selectedSong);
            if (selectedVoice) fd.append('VoiceFile', selectedVoice);
            selectedPhotos.forEach(f => fd.append('ImageFiles', f));

            const res = await api('/api/settings', { method: 'POST', body: fd });
            const data = await res.json().catch(() => ({}));

            if (res.status === 401) { pin = null; showTab('tab-lock'); say('The PIN was rejected. Enter it again.', true); return; }
            if (!res.ok) { say(data.message || 'Could not save the settings.', true); return; }

            app.apply(data);
            resetMedia();
            closeModal();
            toast('Settings saved');
        } catch {
            say('Network error. Check your connection and try again.', true);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Save changes';
        }
    });
})();