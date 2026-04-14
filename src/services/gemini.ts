import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export interface SongRecommendation {
  title: string;
  artist: string;
  artwork: string;
  duration: string;
  genre: string;
}

export const generatePlaylistByMood = async (mood: string): Promise<SongRecommendation[]> => {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Generate a list of 10 songs that match the mood: "${mood}". 
    For each song, provide: title, artist, a descriptive artwork URL (use picsum.photos with relevant keywords), duration (m:ss), and genre.
    Ensure the songs are diverse and fit the mood perfectly.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            artist: { type: Type.STRING },
            artwork: { type: Type.STRING },
            duration: { type: Type.STRING },
            genre: { type: Type.STRING }
          },
          required: ["title", "artist", "artwork", "duration", "genre"]
        }
      }
    }
  });

  try {
    return JSON.parse(response.text);
  } catch (e) {
    console.error("Failed to parse Gemini response", e);
    return [];
  }
};

export const moderateContent = async (text: string): Promise<{ isAppropriate: boolean; reason?: string }> => {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Analyze the following text for appropriateness in a music playlist context. 
    Check for hate speech, explicit violence, or highly offensive content.
    Text: "${text}"`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          isAppropriate: { type: Type.BOOLEAN },
          reason: { type: Type.STRING }
        },
        required: ["isAppropriate"]
      }
    }
  });

  try {
    return JSON.parse(response.text);
  } catch (e) {
    return { isAppropriate: true };
  }
};
