import { MovieSuggestion } from '../types';

export async function fetchMovieRecommendations(params: {
  mood?: string;
  genre?: string;
  runtime?: string;
  prompt?: string;
}): Promise<MovieSuggestion[]> {
  try {
    const res = await fetch('/api/gemini/recommendations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      throw new Error(`Server returned ${res.status}`);
    }

    const data = await res.json();
    return (data.movies || []).map((m: any) => ({
      ...m,
      votes: {},
    }));
  } catch (err) {
    console.warn('Recommendation fetch failed, using fallback catalogue:', err);
    return [
      {
        id: 'cur-1',
        title: 'Dune: Part Two (Çöl Gezegeni 2)',
        year: 2024,
        genre: ['Bilim Kurgu', 'Macera', 'Aksiyon'],
        duration: '166 dk',
        rating: 8.6,
        description: 'Paul Atreides, ailesini yok eden komplo kurucularından intikam almak için Chani ve Fremenlerle birleşir.',
        suggestedReason: 'Arkadaşlarla dev ekranda izlemek için görsel ve işitsel bir şaheser.',
        trailerYoutubeUrl: 'https://www.youtube.com/watch?v=Way9Dexny3w',
        votes: {},
      },
      {
        id: 'cur-2',
        title: 'Everything Everywhere All at Once',
        year: 2022,
        genre: ['Aksiyon', 'Macera', 'Komedi'],
        duration: '139 dk',
        rating: 7.8,
        description: 'Vergi denetiminde bunalan bir göçmen kadın, çoklu evrenleri kurtarabilecek tek kişi olduğunu keşfeder.',
        suggestedReason: 'Kahkahalar ve derin felsefi anlar arasında gidip gelen inanılmaz bir tempo.',
        trailerYoutubeUrl: 'https://www.youtube.com/watch?v=wxN1T1uxQ2g',
        votes: {},
      },
      {
        id: 'cur-3',
        title: 'Spider-Man: Across the Spider-Verse',
        year: 2023,
        genre: ['Animasyon', 'Aksiyon', 'Macera'],
        duration: '140 dk',
        rating: 8.6,
        description: 'Miles Morales çoklu evrende diğer Örümcek-İnsanlarla karşı karşıya gelirken kendi kahramanlık tanımını yeniden yazar.',
        suggestedReason: 'Göz alıcı sanat yönetimi ve 60fps akışta izlenmesi gereken baş döndürücü animasyon.',
        trailerYoutubeUrl: 'https://www.youtube.com/watch?v=cqGjhVJWtEg',
        votes: {},
      },
    ];
  }
}
