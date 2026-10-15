import React, { useState } from 'react';
import {
  Sparkles,
  Film,
  Star,
  Clock,
  ThumbsUp,
  ThumbsDown,
  Play,
  CheckCircle,
  Vote,
  Search,
  Filter,
} from 'lucide-react';
import { MovieSuggestion, RoomState } from '../types';
import { fetchMovieRecommendations } from '../services/api';

interface MovieDiscoveryProps {
  onLoadMovieIntoCinema: (title: string, url: string) => void;
  isHost: boolean;
  currentUserId: string;
  activeVote?: RoomState['activeVote'];
  onStartVote: (movie: MovieSuggestion) => void;
  onCastVote: (vote: 'yes' | 'no') => void;
}

const GENRES = [
  'Tümü',
  'Bilim Kurgu',
  'Gerilim & Gizem',
  'Komedi & Eğlence',
  'Aksiyon',
  'Korku',
  'Animasyon',
  'Dram',
];

export const MovieDiscovery: React.FC<MovieDiscoveryProps> = ({
  onLoadMovieIntoCinema,
  isHost,
  currentUserId,
  activeVote,
  onStartVote,
  onCastVote,
}) => {
  const [selectedGenre, setSelectedGenre] = useState<string>('Tümü');
  const [moodPrompt, setMoodPrompt] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [movies, setMovies] = useState<MovieSuggestion[]>([]);

  const handleFetchRecommendations = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setLoading(true);

    try {
      const results = await fetchMovieRecommendations({
        genre: selectedGenre !== 'Tümü' ? selectedGenre : undefined,
        prompt: moodPrompt.trim() || undefined,
      });
      setMovies(results);
    } catch (err) {
      console.error('Fetch recommendations error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-[#0e1424] border border-slate-800/80 rounded-xl overflow-hidden shadow-xl p-4">
      {/* Active Room Vote Banner (if any) */}
      {activeVote && (
        <div className="mb-4 p-3 bg-rose-950/40 border border-rose-800/80 rounded-xl flex flex-col gap-2 shadow-md">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-bold text-rose-300">
              <Vote className="w-4 h-4 text-rose-400" />
              Aktif Oda Oylaması: "{activeVote.movie.title}"
            </span>
            <span className="text-[10px] text-slate-400">
              Evet: {activeVote.yesVotes.length} · Hayır: {activeVote.noVotes.length}
            </span>
          </div>

          <p className="text-xs text-slate-300 line-clamp-2">
            {activeVote.movie.description}
          </p>

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <button
                onClick={() => onCastVote('yes')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                  activeVote.yesVotes.includes(currentUserId)
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                }`}
              >
                <ThumbsUp className="w-3.5 h-3.5" />
                <span>İzleyelim ({activeVote.yesVotes.length})</span>
              </button>

              <button
                onClick={() => onCastVote('no')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                  activeVote.noVotes.includes(currentUserId)
                    ? 'bg-rose-600 text-white'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                }`}
              >
                <ThumbsDown className="w-3.5 h-3.5" />
                <span>Pas ({activeVote.noVotes.length})</span>
              </button>
            </div>

            {activeVote.movie.trailerYoutubeUrl && (
              <button
                onClick={() =>
                  onLoadMovieIntoCinema(
                    activeVote.movie.title,
                    activeVote.movie.trailerYoutubeUrl!
                  )
                }
                className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white transition-colors"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Sahneye Yükle</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Header and Search Form */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-rose-600/20 text-rose-400 flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Gemini Film Öneri Asistanı</h3>
              <p className="text-[11px] text-slate-400">
                Grup ruh halinize ve istediğiniz türe göre anında akıllı film önerileri alın.
              </p>
            </div>
          </div>
        </div>

        {/* Genre Filter Buttons */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-2 scrollbar-thin">
          {GENRES.map((g) => (
            <button
              key={g}
              onClick={() => setSelectedGenre(g)}
              className={`px-3 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                selectedGenre === g
                  ? 'bg-rose-600 text-white'
                  : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
              }`}
            >
              {g}
            </button>
          ))}
        </div>

        {/* Prompt Input Form */}
        <form onSubmit={handleFetchRecommendations} className="mt-2 flex gap-2">
          <input
            type="text"
            placeholder="Örn: Arkadaşlarla gece izlenecek sürükleyici gerilim ve ters köşe filmi..."
            value={moodPrompt}
            onChange={(e) => setMoodPrompt(e.target.value)}
            className="flex-1 px-3.5 py-2 text-xs bg-slate-950 border border-slate-700/80 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-rose-500"
          />
          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shadow-sm"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{loading ? 'Öneriler Hazırlanıyor...' : 'Film Öner'}</span>
          </button>
        </form>
      </div>

      {/* Recommendations Grid */}
      <div className="flex-1 overflow-y-auto space-y-3 scrollbar-thin pr-1">
        {movies.length === 0 && !loading && (
          <div className="h-64 flex flex-col items-center justify-center text-center p-6 text-slate-500">
            <Film className="w-10 h-10 mb-2 text-slate-600" />
            <p className="text-xs font-semibold text-slate-300">Henüz bir arama yapılmadı</p>
            <p className="text-[11px] text-slate-500 mt-1 max-w-sm">
              Yukarıdaki butona tıklayarak yapay zekanın arkadaş grubunuz için seçtiği en iyi filmleri keşfedin.
            </p>
            <button
              onClick={() => handleFetchRecommendations()}
              className="mt-3 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
            >
              Önerilen Popüler Filmleri Getir
            </button>
          </div>
        )}

        {loading && (
          <div className="h-48 flex flex-col items-center justify-center gap-2 text-slate-400 text-xs">
            <div className="w-6 h-6 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
            <span>Gemini zevkinize uygun sinema başyapıtlarını derliyor...</span>
          </div>
        )}

        {movies.map((m) => (
          <div
            key={m.id}
            className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 transition-all flex flex-col gap-2"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-white">{m.title}</h4>
                  <span className="text-xs text-slate-400 font-mono">({m.year})</span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                  <span className="flex items-center gap-1 text-amber-400 font-semibold font-mono">
                    <Star className="w-3 h-3 fill-amber-400" />
                    {m.rating}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="flex items-center gap-1 text-slate-400">
                    <Clock className="w-3 h-3" />
                    {m.duration}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="text-slate-300 font-medium">{m.genre.join(', ')}</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => onStartVote(m)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors border border-slate-700"
                  title="Oda Üyeleriyle Oylama Başlat"
                >
                  <Vote className="w-3.5 h-3.5 text-rose-400" />
                  <span>Oyla</span>
                </button>

                {m.trailerYoutubeUrl && (
                  <button
                    onClick={() => onLoadMovieIntoCinema(m.title, m.trailerYoutubeUrl!)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition-colors shadow-sm"
                    title="Bu Filmin Fragmanını Sinemaya Yükle"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Yükle</span>
                  </button>
                )}
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">{m.description}</p>

            {m.suggestedReason && (
              <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/80 text-[11px] text-rose-300/90 flex items-start gap-1.5">
                <span className="font-semibold text-rose-400 shrink-0">Grupça İzleme Notu:</span>
                <span>{m.suggestedReason}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
