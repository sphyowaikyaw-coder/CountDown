using Microsoft.AspNetCore.Http;

namespace HappyBirthday.Models
{
    public class BirthdaySettingsRequest
    {
        public string? Name { get; set; }
        public string? BirthdayDate { get; set; }  
        public string? Greeting { get; set; }
        public string? BirthDate { get; set; }      
        public string? BirthTime { get; set; }       
        public bool ClearBirthDate { get; set; }    
        public IFormFile? SongFile { get; set; }
        public IFormFile? VoiceFile { get; set; }
        public List<IFormFile>? ImageFiles { get; set; }
    }
}