using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using HappyBirthday.Models;
using Microsoft.AspNetCore.Mvc;

namespace HappyBirthday.Controllers
{
    public class HomeController : Controller
    {
        private static readonly object Gate = new();
        private readonly ILogger<HomeController> _logger;
        private readonly IWebHostEnvironment _env;
        private readonly IConfiguration _config;

        public HomeController(ILogger<HomeController> logger, IWebHostEnvironment env, IConfiguration config)
        {
            _logger = logger;
            _env = env;
            _config = config;
        }

        private string SettingsPath => Path.Combine(_env.ContentRootPath, "App_Data", "settings.json");
        private string AudioDir => Path.Combine(_env.WebRootPath, "audio");
        private string VoiceDir => Path.Combine(_env.WebRootPath, "audio", "voice");
        private string ImageDir => Path.Combine(_env.WebRootPath, "images", "birthday");


        private StoredSettings LoadSettings()
        {
            lock (Gate)
            {
                try
                {
                    if (System.IO.File.Exists(SettingsPath))
                        return JsonSerializer.Deserialize<StoredSettings>(System.IO.File.ReadAllText(SettingsPath)) ?? new();
                }
                catch (Exception ex) { _logger.LogWarning(ex, "Could not read settings.json, using defaults."); }
                return new StoredSettings();
            }
        }

        private void SaveSettingsFile(StoredSettings s)
        {
            lock (Gate)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(SettingsPath)!);
                System.IO.File.WriteAllText(SettingsPath, JsonSerializer.Serialize(s, new JsonSerializerOptions { WriteIndented = true }));
            }
        }

        private static string TitleFrom(string file)
        {
            var t = Path.GetFileNameWithoutExtension(file).Replace('-', ' ').Replace('_', ' ');
            return CultureInfo.InvariantCulture.TextInfo.ToTitleCase(t);
        }


        private bool IsAdmin()
        {
            var pin = _config["AdminPin"];
            if (string.IsNullOrEmpty(pin)) return false; 
            var sent = Request.Headers["X-Admin-Pin"].ToString();
            return CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(sent), Encoding.UTF8.GetBytes(pin));
        }

        [HttpPost("/api/admin/verify")]
        public IActionResult VerifyPin() =>
            IsAdmin() ? Ok(new { ok = true }) : Unauthorized(new { message = "Wrong PIN." });


        public IActionResult Index()
        {
            var s = LoadSettings();
            return View(new BirthdayViewModel
            {
                BirthdayPersonName = s.Name,
                BirthdayDate = s.BirthdayDate,
                GreetingMessage = s.Greeting,
                SongFile = s.SongFile,
                SongTitle = TitleFrom(s.SongFile),
                VoiceFile = s.VoiceFile
            });
        }

        [HttpPost("/api/settings")]
        [RequestSizeLimit(50_000_000)]
        public async Task<IActionResult> SaveSettings([FromForm] BirthdaySettingsRequest req)
        {
            if (!IsAdmin()) return Unauthorized(new { message = "Admin PIN required." });

            var s = LoadSettings();
            bool songUploaded = false, voiceUploaded = false;

            if (req.SongFile is { Length: > 0 })
            {
                if (!await LooksLikeMp3Async(req.SongFile))
                    return BadRequest(new { message = "The theme song must be a valid .mp3 file." });
                s.SongFile = await SaveMp3Async(req.SongFile, AudioDir);
                songUploaded = true;
            }

            if (req.VoiceFile is { Length: > 0 })
            {
                if (!await LooksLikeMp3Async(req.VoiceFile))
                    return BadRequest(new { message = "The voice greeting must be a valid .mp3 file." });
                s.VoiceFile = await SaveMp3Async(req.VoiceFile, VoiceDir);
                voiceUploaded = true;
            }

            var imagesUploaded = 0;
            if (req.ImageFiles is { Count: > 0 })
            {
                var incoming = req.ImageFiles.Where(f => f.Length > 0).ToList();
                if (ListImages(ImageDir).Count + incoming.Count > MaxPhotos)
                    return BadRequest(new { message = $"You can keep up to {MaxPhotos} photos. Remove some first." });

                var checkedImages = new List<(IFormFile File, string Ext)>();
                foreach (var img in incoming)
                {
                    if (img.Length > 8_000_000)
                        return BadRequest(new { message = $"{img.FileName} is larger than 8 MB." });
                    var ext = await DetectImageExtAsync(img);
                    if (ext is null)
                        return BadRequest(new { message = $"{img.FileName} is not a JPG, PNG, WebP or GIF image." });
                    checkedImages.Add((img, ext));
                }
                foreach (var (file, ext) in checkedImages)
                {
                    await SaveFileAsync(file, ImageDir, ext);
                    imagesUploaded++;
                }
            }

            if (!string.IsNullOrWhiteSpace(req.Name))
                s.Name = req.Name.Trim()[..Math.Min(60, req.Name.Trim().Length)];

            if (!string.IsNullOrWhiteSpace(req.Greeting))
                s.Greeting = req.Greeting.Trim()[..Math.Min(200, req.Greeting.Trim().Length)];

            if (!string.IsNullOrWhiteSpace(req.BirthdayDate))
            {
                if (!DateTimeOffset.TryParse(req.BirthdayDate, CultureInfo.InvariantCulture,
                        DateTimeStyles.RoundtripKind, out var parsed))
                    return BadRequest(new { message = "That date and time is not valid." });
                s.BirthdayDate = parsed;
            }

            SaveSettingsFile(s);

            return Ok(new
            {
                name = s.Name,
                birthdayDate = s.BirthdayDate.ToString("o"),
                greeting = s.Greeting,
                songFile = s.SongFile,
                voiceFile = s.VoiceFile,
                songUploaded,
                voiceUploaded,
                imagesUploaded
            });
        }

        private static async Task<bool> LooksLikeMp3Async(IFormFile file)
        {
            if (!Path.GetExtension(file.FileName).Equals(".mp3", StringComparison.OrdinalIgnoreCase)) return false;
            await using var stream = file.OpenReadStream();
            var b = new byte[3];
            var n = await stream.ReadAsync(b.AsMemory(0, 3));
            return n == 3 && ((b[0] == 'I' && b[1] == 'D' && b[2] == '3') || (b[0] == 0xFF && (b[1] & 0xE0) == 0xE0));
        }

        private const int MaxPhotos = 30;
        private static readonly string[] ImageExts = { ".jpg", ".png", ".webp", ".gif" };

        private static async Task<string?> DetectImageExtAsync(IFormFile file)
        {
            await using var stream = file.OpenReadStream();
            var b = new byte[12];
            var n = await stream.ReadAsync(b.AsMemory(0, 12));
            if (n < 12) return null;
            if (b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF) return ".jpg";
            if (b[0] == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G') return ".png";
            if (b[0] == 'G' && b[1] == 'I' && b[2] == 'F' && b[3] == '8') return ".gif";
            if (b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F' &&
                b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P') return ".webp";
            return null;
        }

        private static async Task SaveFileAsync(IFormFile file, string folderPath, string ext)
        {
            Directory.CreateDirectory(folderPath);
            var raw = Path.GetFileNameWithoutExtension(file.FileName);
            var safe = string.Concat(raw.Select(ch => char.IsLetterOrDigit(ch) || ch is '-' or '_' ? ch : '_'));
            if (string.IsNullOrWhiteSpace(safe)) safe = "photo";

            var fileName = $"{safe}{ext}";
            for (var i = 2; System.IO.File.Exists(Path.Combine(folderPath, fileName)); i++)
                fileName = $"{safe}-{i}{ext}";

            await using var stream = new FileStream(Path.Combine(folderPath, fileName), FileMode.CreateNew);
            await file.CopyToAsync(stream);
        }

        private static async Task<string> SaveMp3Async(IFormFile file, string folderPath)
        {
            Directory.CreateDirectory(folderPath);

            var raw = Path.GetFileNameWithoutExtension(file.FileName);
            var safe = string.Concat(raw.Select(ch => char.IsLetterOrDigit(ch) || ch is '-' or '_' ? ch : '_'));
            if (string.IsNullOrWhiteSpace(safe)) safe = "audio";

            var fileName = $"{safe}.mp3";
            for (var i = 2; System.IO.File.Exists(Path.Combine(folderPath, fileName)); i++)
                fileName = $"{safe}-{i}.mp3";

            await using var stream = new FileStream(Path.Combine(folderPath, fileName), FileMode.CreateNew);
            await file.CopyToAsync(stream);
            return fileName;
        }


        private static List<string> ListMp3(string dir) =>
            Directory.Exists(dir)
                ? Directory.GetFiles(dir, "*.mp3", SearchOption.TopDirectoryOnly)
                    .Select(f => Path.GetFileName(f)!).OrderBy(f => f).ToList()
                : new List<string>();

        [HttpGet("/api/audio-list")]
        public IActionResult AudioList() => Json(ListMp3(AudioDir));

        [HttpGet("/api/voice-list")]
        public IActionResult VoiceList() => Json(ListMp3(VoiceDir));

        [HttpDelete("/api/audio/{fileName}")]
        public IActionResult DeleteAudio(string fileName) => DeleteFrom(AudioDir, fileName, isVoice: false);

        [HttpDelete("/api/voice/{fileName}")]
        public IActionResult DeleteVoice(string fileName) => DeleteFrom(VoiceDir, fileName, isVoice: true);

        private IActionResult DeleteFrom(string dir, string fileName, bool isVoice)
        {
            if (!IsAdmin()) return Unauthorized(new { message = "Admin PIN required." });
            if (string.IsNullOrWhiteSpace(fileName)) return BadRequest(new { message = "File name is required." });

            var safeName = Path.GetFileName(fileName);
            if (!safeName.EndsWith(".mp3", StringComparison.OrdinalIgnoreCase))
                return BadRequest(new { message = "Only .mp3 files can be removed." });

            var root = Path.GetFullPath(dir);
            var fullPath = Path.GetFullPath(Path.Combine(root, safeName));
            if (!fullPath.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                return BadRequest(new { message = "Invalid file path." });
            if (!System.IO.File.Exists(fullPath)) return NotFound(new { message = "File not found." });

            var remaining = ListMp3(dir).Where(f => !f.Equals(safeName, StringComparison.OrdinalIgnoreCase)).ToList();
            if (!isVoice && remaining.Count == 0)
                return BadRequest(new { message = "Keep at least one theme song." });

            System.IO.File.Delete(fullPath);

            var s = LoadSettings();
            var current = isVoice ? s.VoiceFile : s.SongFile;
            if (current.Equals(safeName, StringComparison.OrdinalIgnoreCase) && remaining.Count > 0)
            {
                if (isVoice) s.VoiceFile = remaining[0]; else s.SongFile = remaining[0];
                SaveSettingsFile(s);
            }

            return Ok(new { deleted = safeName });
        }

        private static List<string> ListImages(string dir) =>
            Directory.Exists(dir)
                ? Directory.GetFiles(dir)
                    .Where(f => ImageExts.Contains(Path.GetExtension(f).ToLowerInvariant()))
                    .Select(f => Path.GetFileName(f)!).OrderBy(f => f).ToList()
                : new List<string>();

        [HttpGet("/api/image-list")]
        public IActionResult ImageList() => Json(ListImages(ImageDir));

        [HttpDelete("/api/image/{fileName}")]
        public IActionResult DeleteImage(string fileName)
        {
            if (!IsAdmin()) return Unauthorized(new { message = "Admin PIN required." });

            var safeName = Path.GetFileName(fileName ?? "");
            if (!ImageExts.Contains(Path.GetExtension(safeName).ToLowerInvariant()))
                return BadRequest(new { message = "Only photos can be removed here." });

            var root = Path.GetFullPath(ImageDir);
            var fullPath = Path.GetFullPath(Path.Combine(root, safeName));
            if (!fullPath.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                return BadRequest(new { message = "Invalid file path." });
            if (!System.IO.File.Exists(fullPath)) return NotFound(new { message = "Photo not found." });

            System.IO.File.Delete(fullPath);
            return Ok(new { deleted = safeName });
        }

        public IActionResult Privacy() => View();

        [ResponseCache(Duration = 0, Location = ResponseCacheLocation.None, NoStore = true)]
        public IActionResult Error() =>
            View(new ErrorViewModel { RequestId = Activity.Current?.Id ?? HttpContext.TraceIdentifier });
    }
}