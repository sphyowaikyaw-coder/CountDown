namespace HappyBirthday.Models
{
    public class BirthdayViewModel
    {
        public string BirthdayPersonName { get; set; } = "";
        public DateTimeOffset BirthdayDate { get; set; }
        public string GreetingMessage { get; set; } = "";
        public string SongFile { get; set; } = "birthday.mp3";
        public string SongTitle { get; set; } = "";
        public string VoiceFile { get; set; } = "voice.mp3";

        public string BirthdayDateIso => BirthdayDate.ToString("o");
        public bool IsBirthdayToday => BirthdayDate <= DateTimeOffset.Now;
    }
}