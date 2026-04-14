import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Search, 
  Home, 
  Library, 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  Volume2, 
  MoreVertical, 
  Plus, 
  Music2, 
  History,
  User as UserIcon,
  LogOut,
  Sparkles,
  X,
  Trash2
} from 'lucide-react';
import { auth, signInWithGoogle, logout, db, storage } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  query, 
  onSnapshot, 
  orderBy, 
  deleteDoc, 
  doc, 
  serverTimestamp,
  getDocFromServer
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { generatePlaylistByMood, moderateContent, SongRecommendation } from './services/gemini';
import { cn } from './lib/utils';

// Types
interface Song extends SongRecommendation {
  audioUrl?: string;
}

interface Playlist {
  id: string;
  name: string;
  mood?: string;
  songs: Song[];
  createdAt: any;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [mood, setMood] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [currentPlaylist, setCurrentPlaylist] = useState<Playlist | null>(null);
  const [currentSongIndex, setCurrentSongIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showMoodModal, setShowMoodModal] = useState(false);
  const [showManualModal, setShowManualModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Manual Playlist State
  const [manualName, setManualName] = useState('');
  const [manualSongs, setManualSongs] = useState<Song[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [newSong, setNewSong] = useState({ title: '', artist: '', artwork: '', duration: '3:30' });
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [artworkFile, setArtworkFile] = useState<File | null>(null);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Firestore Connection Test
  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();
  }, []);

  // Playlists Listener
  useEffect(() => {
    if (!user) {
      setPlaylists([]);
      return;
    }

    const q = query(
      collection(db, 'users', user.uid, 'playlists'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const p = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Playlist[];
      setPlaylists(p);
    }, (err) => {
      console.error("Firestore Error:", err);
    });

    return unsubscribe;
  }, [user]);

  const handleCreatePlaylist = async () => {
    if (!mood.trim() || !user) return;

    setIsGenerating(true);
    setError(null);

    try {
      // Moderation
      const moderation = await moderateContent(mood);
      if (!moderation.isAppropriate) {
        setError(`Content flagged: ${moderation.reason || 'Inappropriate mood description.'}`);
        setIsGenerating(false);
        return;
      }

      const songs = await generatePlaylistByMood(mood);
      
      const newPlaylist = {
        name: `${mood.charAt(0).toUpperCase() + mood.slice(1)} Vibes`,
        mood,
        songs,
        ownerId: user.uid,
        createdAt: serverTimestamp()
      };

      await addDoc(collection(db, 'users', user.uid, 'playlists'), newPlaylist);
      
      setMood('');
      setShowMoodModal(false);
    } catch (err) {
      console.error(err);
      setError("Failed to generate playlist. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAddSongToManual = async () => {
    if (!newSong.title || !newSong.artist || !user) return;
    
    setIsUploading(true);
    try {
      let audioUrl = '';
      let artworkUrl = newSong.artwork || 'https://picsum.photos/seed/music/400/400';

      if (audioFile) {
        const audioRef = ref(storage, `users/${user.uid}/audio/${Date.now()}_${audioFile.name}`);
        await uploadBytes(audioRef, audioFile);
        audioUrl = await getDownloadURL(audioRef);
      }

      if (artworkFile) {
        const artworkRef = ref(storage, `users/${user.uid}/artwork/${Date.now()}_${artworkFile.name}`);
        await uploadBytes(artworkRef, artworkFile);
        artworkUrl = await getDownloadURL(artworkRef);
      }

      const songToAdd: Song = {
        ...newSong,
        artwork: artworkUrl,
        audioUrl,
        genre: 'Custom'
      };

      setManualSongs([...manualSongs, songToAdd]);
      setNewSong({ title: '', artist: '', artwork: '', duration: '3:30' });
      setAudioFile(null);
      setArtworkFile(null);
    } catch (err) {
      console.error(err);
      setError("Upload failed. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleSaveManualPlaylist = async () => {
    if (!manualName || manualSongs.length === 0 || !user) return;

    try {
      const newPlaylist = {
        name: manualName,
        songs: manualSongs,
        ownerId: user.uid,
        createdAt: serverTimestamp()
      };

      await addDoc(collection(db, 'users', user.uid, 'playlists'), newPlaylist);
      
      setManualName('');
      setManualSongs([]);
      setShowManualModal(false);
    } catch (err) {
      console.error(err);
      setError("Failed to save playlist.");
    }
  };

  const handleDeletePlaylist = async (id: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'playlists', id));
      if (currentPlaylist?.id === id) {
        setCurrentPlaylist(null);
        setIsPlaying(false);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handlePlaySong = async (idx: number) => {
    setCurrentSongIndex(idx);
    setIsPlaying(true);

    if (user && currentPlaylist) {
      const song = currentPlaylist.songs[idx];
      try {
        await addDoc(collection(db, 'users', user.uid, 'history'), {
          songId: `${currentPlaylist.id}-${idx}`,
          title: song.title,
          artist: song.artist,
          playedAt: serverTimestamp()
        });
      } catch (err) {
        console.error("History Error:", err);
      }
    }
  };

  const handleRemoveSong = async (idx: number) => {
    if (!user || !currentPlaylist) return;

    const updatedSongs = [...currentPlaylist.songs];
    updatedSongs.splice(idx, 1);

    try {
      await deleteDoc(doc(db, 'users', user.uid, 'playlists', currentPlaylist.id));
      if (updatedSongs.length > 0) {
        await addDoc(collection(db, 'users', user.uid, 'playlists'), {
          ...currentPlaylist,
          songs: updatedSongs,
          createdAt: serverTimestamp() // Refresh for simplicity in this mock
        });
      }
      setCurrentPlaylist(null); // Reset view to refresh
    } catch (err) {
      console.error("Remove Song Error:", err);
    }
  };

  const currentSong = currentPlaylist?.songs[currentSongIndex];

  if (loading) {
    return (
      <div className="h-screen bg-black flex items-center justify-center">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        >
          <Music2 className="text-red-600 w-12 h-12" />
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-black text-white flex flex-col font-sans overflow-hidden">
      {/* Header */}
      <header className="h-16 border-b border-white/10 flex items-center justify-between px-6 bg-black/80 backdrop-blur-md z-50">
        <div className="flex items-center gap-2">
          <div className="bg-red-600 p-1.5 rounded-full">
            <Play className="fill-white w-4 h-4" />
          </div>
          <span className="text-xl font-bold tracking-tight">Music</span>
        </div>

        <div className="flex-1 max-w-2xl mx-8 relative hidden md:block">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 w-5 h-5" />
          <input 
            type="text" 
            placeholder="Search songs, albums, artists, moods"
            className="w-full bg-white/5 border border-white/10 rounded-full py-2.5 pl-12 pr-4 focus:outline-none focus:bg-white/10 transition-all"
          />
        </div>

        <div className="flex items-center gap-4">
          {user ? (
            <div className="flex items-center gap-3">
              <img src={user.photoURL || ''} alt="" className="w-8 h-8 rounded-full border border-white/20" />
              <button onClick={logout} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                <LogOut className="w-5 h-5 text-white/60" />
              </button>
            </div>
          ) : (
            <button 
              onClick={signInWithGoogle}
              className="bg-white text-black px-4 py-1.5 rounded-full font-medium hover:bg-white/90 transition-colors"
            >
              Sign In
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="w-64 border-r border-white/10 p-4 flex flex-col gap-2 hidden lg:flex">
          <NavItem icon={<Home />} label="Home" active />
          <NavItem icon={<Sparkles />} label="Explore" />
          <NavItem icon={<Library />} label="Library" />
          
          <div className="mt-8 mb-2 px-4 text-xs font-bold text-white/40 uppercase tracking-widest">
            My Playlists
          </div>
          <div className="flex-1 overflow-y-auto space-y-1 pr-2 custom-scrollbar">
            {playlists.map(p => (
              <button 
                key={p.id}
                onClick={() => {
                  setCurrentPlaylist(p);
                  setCurrentSongIndex(0);
                }}
                className={cn(
                  "w-full text-left px-4 py-2 rounded-lg text-sm transition-colors flex items-center justify-between group",
                  currentPlaylist?.id === p.id ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5 hover:text-white"
                )}
              >
                <span className="truncate">{p.name}</span>
                <Trash2 
                  className="w-4 h-4 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all" 
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeletePlaylist(p.id);
                  }}
                />
              </button>
            ))}
            <button 
              onClick={() => setShowMoodModal(true)}
              className="w-full flex items-center gap-2 px-4 py-2 rounded-lg text-sm text-red-500 hover:bg-red-500/10 transition-colors mt-2"
            >
              <Plus className="w-4 h-4" />
              New AI Playlist
            </button>
            <button 
              onClick={() => setShowManualModal(true)}
              className="w-full flex items-center gap-2 px-4 py-2 rounded-lg text-sm text-white/60 hover:bg-white/5 hover:text-white transition-colors"
            >
              <Plus className="w-4 h-4" />
              Manual Playlist
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-8 bg-gradient-to-b from-white/5 to-transparent custom-scrollbar">
          {currentPlaylist ? (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-5xl mx-auto"
            >
              <div className="flex flex-col md:flex-row gap-8 items-end mb-12">
                <img 
                  src={currentPlaylist.songs[0]?.artwork || 'https://picsum.photos/seed/music/400/400'} 
                  alt="" 
                  className="w-64 h-64 rounded-xl shadow-2xl object-cover"
                />
                <div className="flex-1">
                  <span className="text-sm font-bold text-red-500 uppercase tracking-widest">Playlist</span>
                  <h1 className="text-6xl font-black mt-2 mb-4 tracking-tighter">{currentPlaylist.name}</h1>
                  <div className="flex items-center gap-4 text-white/60">
                    <span className="flex items-center gap-1"><UserIcon className="w-4 h-4" /> {user?.displayName}</span>
                    <span>•</span>
                    <span>{currentPlaylist.songs.length} songs</span>
                  </div>
                  <div className="flex items-center gap-4 mt-8">
                    <button 
                      onClick={() => setIsPlaying(!isPlaying)}
                      className="bg-white text-black px-8 py-3 rounded-full font-bold flex items-center gap-2 hover:scale-105 transition-transform"
                    >
                      {isPlaying ? <Pause className="fill-black" /> : <Play className="fill-black" />}
                      {isPlaying ? 'Pause' : 'Play'}
                    </button>
                    <button className="p-3 border border-white/20 rounded-full hover:bg-white/10 transition-colors">
                      <Plus className="w-6 h-6" />
                    </button>
                    <button className="p-3 border border-white/20 rounded-full hover:bg-white/10 transition-colors">
                      <MoreVertical className="w-6 h-6" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <div className="grid grid-cols-[48px_1fr_1fr_80px] px-4 py-2 text-xs font-bold text-white/40 uppercase tracking-widest border-b border-white/10 mb-2">
                  <span>#</span>
                  <span>Title</span>
                  <span>Artist</span>
                  <span className="text-right">Time</span>
                </div>
                {currentPlaylist.songs.map((song, idx) => (
                  <div 
                    key={idx}
                    onClick={() => handlePlaySong(idx)}
                    className={cn(
                      "grid grid-cols-[48px_1fr_1fr_80px] items-center px-4 py-3 rounded-lg cursor-pointer group transition-colors",
                      currentSongIndex === idx ? "bg-white/10" : "hover:bg-white/5"
                    )}
                  >
                    <div className="text-white/40 group-hover:hidden">{idx + 1}</div>
                    <div className="hidden group-hover:block"><Play className="w-4 h-4 fill-white" /></div>
                    <div className="flex items-center gap-3">
                      <img src={song.artwork} alt="" className="w-10 h-10 rounded object-cover" />
                      <span className={cn("font-medium", currentSongIndex === idx && "text-red-500")}>{song.title}</span>
                    </div>
                    <div className="text-white/60 flex items-center justify-between">
                      <span>{song.artist}</span>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveSong(idx);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 transition-all"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="text-white/40 text-right">{song.duration}</div>
                  </div>
                ))}
              </div>
            </motion.div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto">
              <div className="w-24 h-24 bg-white/5 rounded-full flex items-center justify-center mb-6">
                <Sparkles className="w-10 h-10 text-red-500" />
              </div>
              <h2 className="text-3xl font-bold mb-4">Your AI Music Hub</h2>
              <p className="text-white/60 mb-8">
                Tell us how you're feeling, and we'll craft the perfect soundtrack for your moment using advanced AI.
              </p>
              <button 
                onClick={() => setShowMoodModal(true)}
                className="bg-red-600 text-white px-8 py-3 rounded-full font-bold hover:bg-red-700 transition-all hover:scale-105"
              >
                Create My First Mood Playlist
              </button>
            </div>
          )}
        </main>
      </div>

      {/* Player Bar */}
      <AnimatePresence>
        {currentPlaylist && (
          <motion.footer 
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            exit={{ y: 100 }}
            className="h-24 bg-black border-t border-white/10 px-6 flex items-center justify-between z-50"
          >
            <div className="flex items-center gap-4 w-1/3">
              <img 
                src={currentSong?.artwork || ''} 
                alt="" 
                className="w-14 h-14 rounded-md object-cover shadow-lg"
              />
              <div className="flex flex-col">
                <span className="font-bold text-sm truncate max-w-[200px]">{currentSong?.title}</span>
                <span className="text-xs text-white/60 truncate max-w-[200px]">{currentSong?.artist}</span>
              </div>
            </div>

            <div className="flex flex-col items-center gap-2 w-1/3">
              <div className="flex items-center gap-6">
                <button className="text-white/60 hover:text-white"><SkipBack className="w-5 h-5 fill-current" /></button>
                <button 
                  onClick={() => setIsPlaying(!isPlaying)}
                  className="bg-white text-black p-2.5 rounded-full hover:scale-110 transition-transform"
                >
                  {isPlaying ? <Pause className="w-6 h-6 fill-black" /> : <Play className="w-6 h-6 fill-black" />}
                </button>
                <button className="text-white/60 hover:text-white"><SkipForward className="w-5 h-5 fill-current" /></button>
              </div>
              {currentSong?.audioUrl && (
                <audio 
                  src={currentSong.audioUrl} 
                  autoPlay={isPlaying} 
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  className="hidden"
                />
              )}
              <div className="w-full max-w-md flex items-center gap-3 text-[10px] text-white/40 font-bold">
                <span>1:24</span>
                <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                  <motion.div 
                    className="h-full bg-red-600"
                    initial={{ width: "30%" }}
                    animate={{ width: isPlaying ? "100%" : "30%" }}
                    transition={{ duration: 180, ease: "linear" }}
                  />
                </div>
                <span>{currentSong?.duration}</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-4 w-1/3">
              <Volume2 className="w-5 h-5 text-white/60" />
              <div className="w-24 h-1 bg-white/10 rounded-full">
                <div className="w-2/3 h-full bg-white rounded-full" />
              </div>
            </div>
          </motion.footer>
        )}
      </AnimatePresence>

      {/* Mood Modal */}
      <AnimatePresence>
        {showMoodModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMoodModal(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[#1c1c1c] w-full max-w-lg rounded-3xl p-8 relative z-10 border border-white/10 shadow-2xl"
            >
              <button 
                onClick={() => setShowMoodModal(false)}
                className="absolute right-6 top-6 text-white/40 hover:text-white"
              >
                <X className="w-6 h-6" />
              </button>

              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-red-500/20 rounded-xl">
                  <Sparkles className="text-red-500 w-6 h-6" />
                </div>
                <h3 className="text-2xl font-bold">Create Mood Playlist</h3>
              </div>

              <p className="text-white/60 mb-6 text-sm leading-relaxed">
                Describe your current vibe, activity, or feelings. Our AI will curate a unique 10-song playlist just for you.
              </p>

              <div className="space-y-4">
                <textarea 
                  value={mood}
                  onChange={(e) => setMood(e.target.value)}
                  placeholder="e.g. Late night drive through Tokyo, feeling nostalgic but hopeful..."
                  className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 h-32 focus:outline-none focus:border-red-500/50 transition-all resize-none"
                />

                {error && (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-500 text-xs font-medium">
                    {error}
                  </div>
                )}

                <button 
                  onClick={handleCreatePlaylist}
                  disabled={isGenerating || !mood.trim()}
                  className="w-full bg-red-600 text-white py-4 rounded-2xl font-bold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                >
                  {isGenerating ? (
                    <>
                      <motion.div 
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                      >
                        <Sparkles className="w-5 h-5" />
                      </motion.div>
                      Generating your vibe...
                    </>
                  ) : (
                    'Generate Playlist'
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Manual Playlist Modal */}
      <AnimatePresence>
        {showManualModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowManualModal(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[#1c1c1c] w-full max-w-2xl rounded-3xl p-8 relative z-10 border border-white/10 shadow-2xl max-h-[90vh] overflow-y-auto custom-scrollbar"
            >
              <button 
                onClick={() => setShowManualModal(false)}
                className="absolute right-6 top-6 text-white/40 hover:text-white"
              >
                <X className="w-6 h-6" />
              </button>

              <h3 className="text-2xl font-bold mb-6">Create Manual Playlist</h3>

              <div className="space-y-6">
                <div>
                  <label className="block text-xs font-bold text-white/40 uppercase tracking-widest mb-2">Playlist Name</label>
                  <input 
                    type="text" 
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    placeholder="My Awesome Playlist"
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:outline-none focus:border-red-500/50"
                  />
                </div>

                <div className="border-t border-white/10 pt-6">
                  <h4 className="text-sm font-bold mb-4">Add Songs</h4>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <input 
                      type="text" 
                      placeholder="Song Title"
                      value={newSong.title}
                      onChange={(e) => setNewSong({...newSong, title: e.target.value})}
                      className="bg-white/5 border border-white/10 rounded-xl p-3 text-sm focus:outline-none"
                    />
                    <input 
                      type="text" 
                      placeholder="Artist"
                      value={newSong.artist}
                      onChange={(e) => setNewSong({...newSong, artist: e.target.value})}
                      className="bg-white/5 border border-white/10 rounded-xl p-3 text-sm focus:outline-none"
                    />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="block text-[10px] text-white/40 uppercase mb-1">Audio File</label>
                      <input 
                        type="file" 
                        accept="audio/*"
                        onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
                        className="w-full text-xs text-white/40 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-red-500/10 file:text-red-500 hover:file:bg-red-500/20"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-white/40 uppercase mb-1">Artwork Image</label>
                      <input 
                        type="file" 
                        accept="image/*"
                        onChange={(e) => setArtworkFile(e.target.files?.[0] || null)}
                        className="w-full text-xs text-white/40 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-red-500/10 file:text-red-500 hover:file:bg-red-500/20"
                      />
                    </div>
                  </div>

                  <button 
                    onClick={handleAddSongToManual}
                    disabled={isUploading || !newSong.title || !newSong.artist}
                    className="w-full py-3 rounded-xl border border-white/10 text-sm font-bold hover:bg-white/5 transition-all flex items-center justify-center gap-2"
                  >
                    {isUploading ? 'Uploading...' : <><Plus className="w-4 h-4" /> Add Song to List</>}
                  </button>
                </div>

                {manualSongs.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-white/40 uppercase tracking-widest">Songs in Playlist ({manualSongs.length})</h4>
                    {manualSongs.map((s, i) => (
                      <div key={i} className="flex items-center justify-between bg-white/5 p-3 rounded-xl">
                        <div className="flex items-center gap-3">
                          <img src={s.artwork} alt="" className="w-8 h-8 rounded object-cover" />
                          <div>
                            <div className="text-sm font-bold">{s.title}</div>
                            <div className="text-xs text-white/40">{s.artist}</div>
                          </div>
                        </div>
                        <button 
                          onClick={() => setManualSongs(manualSongs.filter((_, idx) => idx !== i))}
                          className="text-white/40 hover:text-red-500"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <button 
                  onClick={handleSaveManualPlaylist}
                  disabled={!manualName || manualSongs.length === 0}
                  className="w-full bg-red-600 text-white py-4 rounded-2xl font-bold hover:bg-red-700 disabled:opacity-50 transition-all mt-4"
                >
                  Save Playlist
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      `}} />
    </div>
  );
}

function NavItem({ icon, label, active = false }: { icon: React.ReactNode, label: string, active?: boolean }) {
  return (
    <button className={cn(
      "flex items-center gap-4 px-4 py-3 rounded-xl transition-all w-full text-left",
      active ? "bg-white/10 text-white font-bold" : "text-white/60 hover:bg-white/5 hover:text-white"
    )}>
      {icon}
      <span className="text-sm">{label}</span>
    </button>
  );
}
