namespace HappyBirthday.Models
{
    public class StoredSettings
    {
        public string Name { get; set; } = "MgKyaw";
        public DateTimeOffset BirthdayDate { get; set; } = new(2026, 11, 22, 16, 27, 0, TimeSpan.FromHours(9));
        public string Greeting { get; set; } = "🎉 Happy Birthday, MgKyaw! Wishing you an amazing year ahead! 🎂✨";
        public string SongFile { get; set; } = "birthday.mp3";
        public string VoiceFile { get; set; } = "voice.mp3";
        public string? BirthDate { get; set; }              
        public string BirthTime { get; set; } = "00:00";     
    }
}