import { GoogleGenAI, Type } from '@google/genai';

export default async function handler(req: any, res: any) {
  // Enable CORS for Vercel preview and custom domains
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { mood, genre, runtime, prompt } = req.body || {};

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is not configured');
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const queryPrompt = `
Sen bir sinema uzmanı ve film küratörüsün. Birlikte film izleyecek bir arkadaş grubu için en iyi 4 film/dizi tavsiyesini oluştur.
Kullanıcı tercihleri:
- İstenen Tür: ${genre || 'Fark etmez'}
- Ruh Hali: ${mood || 'Sürükleyici, heyecanlı veya keyifli'}
- Süre: ${runtime || 'Standart (90-140 dk)'}
- Özel Not / İstek: ${prompt || 'Grupça izlerken kimsenin sıkılmayacağı, akıcı ve kaliteli bir yapım.'}

Her öneri için:
- Başlık (Orijinal ve Türkçe)
- Çıkış Yılı
- Türler (en fazla 3)
- Süre
- IMDb / Puan tahmini (1-10 arası ondalıklı)
- 2-3 cümlelik heyecan verici film özeti
- "Neden birlikte izlemelisiniz?" gerekçesi (grup dinamiği açısından neden ideal?)
- YouTube'da aratılacak resmi fragman arama terimi
- Örnek direkt oynatılabilir video linki veya fragman başlığı
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: queryPrompt,
      config: {
        systemInstruction: 'Sen CineSync için çalışan profesyonel bir film danışmanısın. Cevabını yalnızca istenen JSON şemasına uygun olarak üret.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              title: { type: Type.STRING },
              year: { type: Type.INTEGER },
              genre: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              duration: { type: Type.STRING },
              rating: { type: Type.NUMBER },
              description: { type: Type.STRING },
              suggestedReason: { type: Type.STRING },
              trailerQuery: { type: Type.STRING },
              trailerYoutubeUrl: { type: Type.STRING },
            },
            required: ['id', 'title', 'year', 'genre', 'duration', 'rating', 'description', 'suggestedReason'],
          },
        },
      },
    });

    const movies = JSON.parse(response.text || '[]');
    return res.status(200).json({ movies });
  } catch (err: any) {
    console.warn('Vercel serverless Gemini recommendation fallback:', err?.message);
    return res.status(200).json({
      movies: [
        {
          id: 'fb-1',
          title: 'Interstellar (Yıldızlararası)',
          year: 2014,
          genre: ['Bilim Kurgu', 'Macera', 'Dram'],
          duration: '169 dk',
          rating: 8.7,
          description: 'İnsanlığın yeni bir yaşanabilir gezegen arayışında solucan deliğinden geçen bir astronot grubunun epik ve duygusal yolculuğu.',
          suggestedReason: 'Arkadaşlarla izlerken görsel şölen, efsanevi Zimmer müzikleri ve üzerinde uzun uzun konuşulacak derin bilim kurgu teorileri sunar.',
          trailerYoutubeUrl: 'https://www.youtube.com/watch?v=zSWdZVtXT7E',
        },
        {
          id: 'fb-2',
          title: 'Knives Out (Bıçaklar Çekildi)',
          year: 2019,
          genre: ['Gizem', 'Komedi', 'Suç'],
          duration: '130 dk',
          rating: 7.9,
          description: 'Zengin bir polisiye yazarının gizemli ölümü sonrası tüm aileyi şüpheli gören dahi dedektif Benoit Blanc\'ın eğlenceli soruşturması.',
          suggestedReason: 'Grupça izlerken katili tahmin etme yarışına dönüşen, temposu hiç düşmeyen son derece eğlenceli bir ters köşe filmi.',
          trailerYoutubeUrl: 'https://www.youtube.com/watch?v=qGqiHJTsRkQ',
        },
        {
          id: 'fb-3',
          title: 'Spider-Man: Into the Spider-Verse',
          year: 2018,
          genre: ['Animasyon', 'Aksiyon', 'Macera'],
          duration: '117 dk',
          rating: 8.4,
          description: 'Miles Morales farklı boyutlardan gelen Örümcek Kahramanlar ile güçlerini birleştirerek çoklu evreni kurtarmak zorundadır.',
          suggestedReason: 'Çığır açan görsel tarzı, harika müzikleri ve 1080p ekranda herkesi büyüleyen akıcı sinematografisiyle kusursuz bir ortak izleme deneyimi.',
          trailerYoutubeUrl: 'https://www.youtube.com/watch?v=g4Hbz2jLxvQ',
        },
        {
          id: 'fb-4',
          title: 'A Quiet Place (Sessiz Bir Yer)',
          year: 2018,
          genre: ['Korku', 'Gerilim', 'Bilim Kurgu'],
          duration: '90 dk',
          rating: 7.5,
          description: 'Sese duyarlı ölümcül yaratıkların istila ettiği bir dünyada hayatta kalabilmek için mutlak sessizlik içinde yaşamak zorunda olan bir ailenin hikayesi.',
          suggestedReason: 'Bas-konuş özelliğimizle mükemmel uyumlu! Film boyu nefesinizi tutup arkadaşlarla gerilim dolu anları anlık paylaşmak için birebir.',
          trailerYoutubeUrl: 'https://www.youtube.com/watch?v=WR7cc5t7tv8',
        },
      ],
    });
  }
}
