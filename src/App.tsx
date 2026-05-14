/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Camera, 
  Settings, 
  History, 
  Plus, 
  Check, 
  Smartphone, 
  User, 
  LogOut, 
  ChevronRight, 
  X,
  Upload,
  Zap,
  ArrowRight,
  TrendingDown,
  Calendar,
  Cloud
} from 'lucide-react';
import { GoogleGenAI, Type } from "@google/genai";
import { UserProfile, MealLog, ACTIVITY_LEVELS } from './types';

// --- Utils ---
const calculateBMR = (profile: UserProfile): number => {
  // Mifflin-St Jeor Equation
  const { weight, height, age, gender, activityLevel } = profile;
  let bmr = (10 * weight) + (6.25 * height) - (5 * age);
  if (gender === 'male') bmr += 5;
  else bmr -= 161;
  return Math.round(bmr * activityLevel);
};

const formatTime = (iso: string) => {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

// --- Components ---

const ProgressBar = ({ current, total }: { current: number, total: number }) => {
  const percentage = Math.min((current / total) * 100, 100);
  const isOverflow = current > total;
  
  return (
    <div className="w-full">
      <div className="flex justify-between items-end mb-2">
        <div>
          <span className="text-3xl font-bold tracking-tighter">{total - current}</span>
          <span className="text-xs text-zinc-500 ml-1 uppercase font-bold">Kcal Left</span>
        </div>
        <div className="text-right">
          <span className="text-xs text-zinc-400 block font-bold uppercase tracking-widest">Goal</span>
          <span className="text-sm font-mono font-bold">{total}</span>
        </div>
      </div>
      <div className="h-6 bg-zinc-100 rounded-full overflow-hidden p-1 border border-zinc-200">
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          className={`h-full rounded-full ${isOverflow ? 'bg-red-500' : 'bg-lime-400 opacity-90'}`}
        />
      </div>
    </div>
  );
};

const Header = ({ onProfile }: { onProfile: () => void }) => (
  <header className="flex justify-between items-center py-6 border-b border-zinc-100 bg-white/80 backdrop-blur-md sticky top-0 z-30 px-6">
    <div className="flex items-center gap-2">
      <div className="w-8 h-8 bg-zinc-900 rounded-lg flex items-center justify-center text-white">
          <Zap size={18} fill="currentColor" />
      </div>
      <span className="font-black tracking-tighter text-2xl uppercase italic">CalorieLens</span>
    </div>
    <button onClick={onProfile} className="w-10 h-10 rounded-full bg-zinc-100 flex items-center justify-center hover:bg-zinc-200 transition-colors">
      <User size={20} />
    </button>
  </header>
);

export default function App() {
  const [view, setView] = useState<'dashboard' | 'camera' | 'profile' | 'history'>('dashboard');
  const [profile, setProfile] = useState<UserProfile>(() => {
    const saved = localStorage.getItem('cl_profile');
    return saved ? JSON.parse(saved) : {
      name: '',
      age: 28,
      weight: 70,
      height: 175,
      gender: 'male',
      activityLevel: 1.375
    };
  });
  
  const [logs, setLogs] = useState<MealLog[]>(() => {
    const saved = localStorage.getItem('cl_logs');
    return saved ? JSON.parse(saved) : [];
  });

  const [isSyncing, setIsSyncing] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [hasSheetsAccess, setHasSheetsAccess] = useState(false);
  const googleBtnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem('cl_profile', JSON.stringify(profile));
  }, [profile]);

  useEffect(() => {
    localStorage.setItem('cl_logs', JSON.stringify(logs));
  }, [logs]);

  useEffect(() => {
    checkAuth();
    initGoogleSignIn();
  }, []);

  const initGoogleSignIn = () => {
    const google = (window as any).google;
    if (google) {
      google.accounts.id.initialize({
        client_id: (import.meta as any).env.VITE_GOOGLE_CLIENT_ID || '', // We'll need to use VITE_ prefix for client side
        callback: handleGoogleResponse,
      });
      if (googleBtnRef.current) {
        google.accounts.id.renderButton(googleBtnRef.current, {
          theme: 'outline',
          size: 'large',
          shape: 'pill'
        });
      }
    }
  };

  const handleGoogleResponse = async (response: any) => {
    try {
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: response.credential })
      });
      const data = await res.json();
      if (data.success) {
        setIsAuthenticated(true);
        fetchData();
      }
    } catch (e) {
      console.error("Login Error:", e);
    }
  };

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/auth/status');
      const data = await res.json();
      setIsAuthenticated(data.isAuthenticated);
      setHasSheetsAccess(data.hasSheetsAccess);
      if (data.isAuthenticated) fetchData();
    } catch (e) {
      console.error(e);
    }
  };

  const fetchData = async () => {
    try {
      const logsRes = await fetch('/api/logs');
      const logsData = await logsRes.json();
      if (Array.isArray(logsData)) {
        const cloudLogs = logsData.map((l: any) => ({
          id: String(l.id),
          food_name: l.foodName,
          calories: l.calories,
          timestamp: l.createdAt,
          image: l.imageUrl,
          synced: true
        }));
        
        setLogs(prev => {
          const unsynced = prev.filter(l => !l.synced);
          return [...unsynced, ...cloudLogs];
        });
        
        setTimeout(syncUnsyncedLogs, 1000);
      }
    } catch (e) {
      console.error("Fetch Data Error:", e);
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setIsAuthenticated(false);
      setHasSheetsAccess(false);
      setLogs([]);
      setView('dashboard');
      // Re-init Google Sign-In button if needed
      setTimeout(initGoogleSignIn, 100);
    } catch (e) {
      console.error(e);
    }
  };

  const deleteLog = async (id: string) => {
    // If it's a serial ID (string containing only digits), it might be from the server
    const isServerId = /^\d+$/.test(id);
    
    if (isAuthenticated && isServerId) {
      try {
        await fetch(`/api/logs/${id}`, { method: 'DELETE' });
      } catch (e) {
        console.error("Delete Error:", e);
      }
    }
    setLogs(prev => prev.filter(l => l.id !== id));
  };

  const updateLog = async (id: string, newCalories: number) => {
    if (isNaN(newCalories)) return;
    const isServerId = /^\d+$/.test(id);
    
    if (isAuthenticated && isServerId) {
      try {
        await fetch(`/api/logs/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ calories: newCalories })
        });
      } catch (e) {
        console.error("Update Error:", e);
      }
    }
    setLogs(prev => prev.map(l => l.id === id ? { ...l, calories: newCalories } : l));
  };

  const syncToSheets = async (log: MealLog) => {
    if (!isAuthenticated) return;
    setIsSyncing(true);
    try {
      const res = await fetch('/api/logs/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs: [log] })
      });
      const data = await res.json();
      if (data.success) {
        setLogs(prev => prev.map(l => l.id === log.id ? { ...l, synced: true } : l));
      }
    } catch (e) {
      console.error("Sync Error:", e);
    } finally {
      setIsSyncing(false);
    }
  };

  const syncUnsyncedLogs = async () => {
    const unsynced = logs.filter(l => !l.synced);
    if (unsynced.length === 0 || !isAuthenticated) return;

    setIsSyncing(true);
    try {
      const res = await fetch('/api/logs/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs: unsynced })
      });
      const data = await res.json();
      if (data.success) {
        const syncedIds = new Set(data.synced.map((s: any) => s.localId));
        setLogs(prev => prev.map(l => syncedIds.has(l.id) ? { ...l, synced: true } : l));
      }
    } catch (e) {
      console.error("Batch Sync Error:", e);
    } finally {
      setIsSyncing(false);
    }
  };

  const dailyCalories = logs
    .filter(log => new Date(log.timestamp).toDateString() === new Date().toDateString())
    .reduce((sum, log) => sum + log.calories, 0);

  const calorieBudget = calculateBMR(profile);

  return (
    <div className="min-h-screen bg-white text-zinc-900 font-sans selection:bg-lime-200">
      <AnimatePresence mode="wait">
        {view === 'dashboard' && (
          <motion.div 
            key="dashboard"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pb-24"
          >
            <Header onProfile={() => setView('profile')} />
            
            <main className="p-6 md:p-12 max-w-2xl mx-auto space-y-12">
              {/* Progress */}
              <section className="bg-zinc-50 border border-zinc-100 p-8 rounded-[2rem] shadow-sm relative overflow-hidden">
                <div className="absolute top-0 right-0 p-6 opacity-5 rotate-12">
                   <TrendingDown size={140} />
                </div>
                <div className="text-[10px] uppercase font-bold tracking-[0.2em] text-zinc-400 mb-6 flex items-center gap-2">
                    <div className="w-1.5 h-1.5 bg-lime-500 rounded-full"></div>
                    {isAuthenticated ? 'Cloud Sync Active' : 'Guest Mode (Local Storage)'}
                </div>
                <ProgressBar current={dailyCalories} total={calorieBudget} />
              </section>

              {/* Quick Actions */}
              <div className="flex gap-4">
                <button 
                  onClick={() => setView('camera')}
                  className="flex-1 bg-zinc-900 text-white p-6 rounded-3xl flex flex-col items-center justify-center gap-3 hover:scale-[0.98] transition-transform active:scale-95 group relative overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-tr from-lime-500/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                  <Camera size={32} />
                  <span className="font-bold uppercase tracking-wider text-xs">Snap Meal</span>
                </button>
                <button 
                  onClick={() => setView('history')}
                  className="w-20 bg-zinc-100 p-6 rounded-3xl flex flex-col items-center justify-center gap-3 hover:bg-zinc-200 transition-colors group"
                >
                  <History size={24} className="group-hover:rotate-12 transition-transform" />
                </button>
              </div>

              {/* Login Invitation for Guests */}
              {!isAuthenticated && (
                <div className="p-8 border-2 border-zinc-900 rounded-[2rem] flex flex-col items-center text-center gap-4">
                  <div className="text-sm font-bold tracking-tight">Save your data to the cloud</div>
                  <p className="text-[11px] text-zinc-400 leading-relaxed max-w-[200px]">Sign in to sync your meal logs with Google Sheets and access them anywhere.</p>
                  <div ref={googleBtnRef}></div>
                </div>
              )}

              {/* Recent Logs */}
              <section>
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-xl font-bold tracking-tight">Today's Fuel</h2>
                  <button onClick={() => setView('history')} className="text-zinc-400 hover:text-zinc-900 transition-colors">
                    <Plus size={20} />
                  </button>
                </div>
                <div className="space-y-3">
                  {logs.filter(log => new Date(log.timestamp).toDateString() === new Date().toDateString()).length === 0 ? (
                    <div className="py-12 text-center text-zinc-400 italic text-sm">No meals logged yet today. Time for a snack?</div>
                  ) : (
                    logs
                      .filter(log => new Date(log.timestamp).toDateString() === new Date().toDateString())
                      .slice(0, 5)
                      .map(log => (
                        <LogItem 
                          key={log.id} 
                          log={log} 
                          onDelete={deleteLog} 
                          onEdit={updateLog} 
                        />
                    ))
                  )}
                </div>
              </section>

              {/* Sync Alert */}
              {isAuthenticated && !hasSheetsAccess && (
                <div className="bg-blue-50 border border-blue-100 p-6 rounded-3xl flex items-center justify-between">
                  <div>
                    <div className="text-sm font-bold text-blue-900">Sheets Sync Off</div>
                    <div className="text-xs text-blue-700">Backup your logs to Google Sheets.</div>
                  </div>
                  <button 
                    onClick={async () => {
                      const res = await fetch('/api/auth/url');
                      const { url } = await res.json();
                      window.open(url, 'oauth', 'width=600,height=700');
                    }}
                    className="bg-blue-600 text-white px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-blue-700 transition-colors"
                  >
                    Connect
                  </button>
                </div>
              )}
            </main>
          </motion.div>
        )}

        {view === 'camera' && (
          <CameraView 
            onClose={() => setView('dashboard')} 
            onLog={(log) => {
              const newLog = { ...log, synced: false };
              setLogs([newLog, ...logs]);
              syncToSheets(newLog);
              setView('dashboard');
            }} 
          />
        )}

        {view === 'profile' && (
          <ProfileView 
            profile={profile} 
            onChange={setProfile} 
            onClose={() => setView('dashboard')} 
            onSyncAuth={checkAuth}
            isAuthenticated={isAuthenticated}
            onLogout={logout}
          />
        )}

        {view === 'history' && (
          <HistoryView 
             logs={logs} 
             onClose={() => setView('dashboard')} 
             onDelete={deleteLog}
             onEdit={updateLog}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Sub-Views ---

const CameraView = ({ onClose, onLog }: { onClose: () => void, onLog: (l: MealLog) => void }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [analysis, setAnalysis] = useState<any>(null);

  useEffect(() => {
    startCamera();
    return () => {
      stream?.getTracks().forEach(t => t.stop());
    };
  }, []);

  const startCamera = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      setStream(s);
      if (videoRef.current) videoRef.current.srcObject = s;
    } catch (e) {
      console.error(e);
    }
  };

  const capture = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')?.drawImage(video, 0, 0);
      const img = canvas.toDataURL('image/jpeg');
      setCapturedImage(img);
      analyzeImage(img);
    }
  };

  const analyzeImage = async (base64: string) => {
    setIsLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              { inlineData: { mimeType: "image/jpeg", data: base64.split(',')[1] } },
              { text: "Identify this food and provide an estimated calorie count. Format the response as JSON with keys: food_name, calories." }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              food_name: { type: Type.STRING },
              calories: { type: Type.INTEGER }
            },
            required: ["food_name", "calories"]
          }
        }
      });
      
      const result = JSON.parse(response.text);
      setAnalysis(result);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 100 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 100 }}
      className="fixed inset-0 bg-zinc-900 z-50 flex flex-col md:p-8"
    >
      <div className="flex-1 relative overflow-hidden md:rounded-[3rem] bg-black">
        {!capturedImage ? (
          <>
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              className="absolute inset-0 w-full h-full object-cover"
            />
            <div className="absolute inset-0 border-[40px] border-black/40 pointer-events-none"></div>
            <div className="absolute top-12 left-1/2 -translate-x-1/2 w-48 h-48 border border-white/30 rounded-3xl"></div>
          </>
        ) : (
          <img src={capturedImage} className="absolute inset-0 w-full h-full object-cover opacity-50" />
        )}

        <button onClick={onClose} className="absolute top-8 right-8 w-12 h-12 bg-white/10 backdrop-blur-lg text-white rounded-full flex items-center justify-center">
          <X size={24} />
        </button>

        {capturedImage && (
          <div className="absolute inset-0 flex items-center justify-center p-8">
            <div className="bg-white rounded-[2.5rem] w-full max-w-md p-8 shadow-2xl">
              {isLoading ? (
                <div className="py-12 flex flex-col items-center gap-4">
                   <div className="w-12 h-12 border-4 border-zinc-100 border-t-zinc-900 rounded-full animate-spin"></div>
                   <div className="text-[10px] uppercase font-black tracking-[0.2em] text-zinc-400">Gemini is Thinking...</div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex items-center gap-3 text-lime-500">
                    <Check size={20} className="bg-lime-100 rounded-full p-1" />
                    <span className="text-[10px] uppercase font-black tracking-widest">Identification Success</span>
                  </div>
                  <div>
                    <h2 className="text-4xl font-black tracking-tighter leading-tight mb-2">{analysis?.food_name || "Unknown Dish"}</h2>
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-mono font-bold">{analysis?.calories || 0}</span>
                      <span className="text-xs uppercase font-bold text-zinc-400">Calories</span>
                    </div>
                  </div>
                  <div className="pt-6 flex gap-3">
                    <button 
                      onClick={() => setCapturedImage(null)}
                      className="flex-1 py-4 border border-zinc-200 rounded-2xl text-xs font-bold uppercase tracking-widest hover:bg-zinc-50"
                    >
                      Retry
                    </button>
                    <button 
                      onClick={() => onLog({ 
                        id: Math.random().toString(36).substr(2, 9),
                        food_name: analysis.food_name,
                        calories: analysis.calories,
                        timestamp: new Date().toISOString(),
                        image: capturedImage
                      })}
                      className="flex-[2] py-4 bg-zinc-900 text-white rounded-2xl text-xs font-bold uppercase tracking-widest hover:bg-zinc-800"
                    >
                      Log Meal
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="p-8 flex justify-center bg-zinc-900">
        {!capturedImage && (
          <button 
            onClick={capture}
            className="w-20 h-20 bg-white rounded-full flex items-center justify-center border-8 border-white/20 active:scale-95 transition-transform"
          >
            <div className="w-14 h-14 bg-white rounded-full border-2 border-zinc-900"></div>
          </button>
        )}
      </div>
      <canvas ref={canvasRef} className="hidden" />
    </motion.div>
  );
};

const ProfileView = ({ profile, onChange, onClose, isAuthenticated, onSyncAuth, onLogout }: { profile: UserProfile, onChange: (p: UserProfile) => void, onClose: () => void, isAuthenticated: boolean, onSyncAuth: () => void, onLogout: () => void }) => {
  return (
    <motion.div 
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 100 }}
      className="fixed inset-0 bg-white z-40 p-6 md:p-12 overflow-y-auto"
    >
      <div className="max-w-xl mx-auto space-y-10">
        <header className="flex justify-between items-center">
          <h2 className="text-3xl font-black tracking-tighter uppercase italic">Profile & Stats</h2>
          <button onClick={onClose} className="w-10 h-10 bg-zinc-100 rounded-full flex items-center justify-center">
            <X size={20} />
          </button>
        </header>

        <section className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-zinc-400 tracking-widest">Weight (KG)</label>
              <input 
                type="number" 
                value={profile.weight} 
                onChange={(e) => onChange({ ...profile, weight: parseInt(e.target.value) })}
                className="w-full bg-zinc-50 p-4 rounded-2xl text-xl font-bold border-transparent focus:border-zinc-900 focus:outline-none transition-all"
              />
            </div>
            <div className="space-y-1">
               <label className="text-[10px] uppercase font-bold text-zinc-400 tracking-widest">Height (CM)</label>
               <input 
                type="number" 
                value={profile.height} 
                onChange={(e) => onChange({ ...profile, height: parseInt(e.target.value) })}
                className="w-full bg-zinc-50 p-4 rounded-2xl text-xl font-bold border-transparent focus:border-zinc-900 focus:outline-none transition-all"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold text-zinc-400 tracking-widest">Age</label>
            <input 
              type="number" 
              value={profile.age} 
              onChange={(e) => onChange({ ...profile, age: parseInt(e.target.value) })}
              className="w-full bg-zinc-50 p-4 rounded-2xl text-xl font-bold border-transparent focus:border-zinc-900 focus:outline-none transition-all"
            />
          </div>

          <div className="space-y-4">
            <label className="text-[10px] uppercase font-bold text-zinc-400 tracking-widest">Activity Level</label>
            <div className="space-y-2">
              {ACTIVITY_LEVELS.map(level => (
                <button 
                  key={level.value}
                  onClick={() => onChange({ ...profile, activityLevel: level.value })}
                  className={`w-full p-4 rounded-2xl text-left text-sm font-bold border transition-all ${profile.activityLevel === level.value ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white border-zinc-100 text-zinc-500'}`}
                >
                  {level.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-zinc-50 p-6 rounded-3xl border border-zinc-100 flex items-center justify-between">
           <div>
              <div className="text-[10px] uppercase font-bold text-zinc-400 mb-1">Sheets Integration</div>
              <div className="text-sm font-bold flex items-center gap-2">
                {isAuthenticated ? (
                  <div className="text-lime-600 flex items-center gap-1"><Cloud size={14} /> Connected</div>
                ) : (
                  <div className="text-zinc-400">Not Synced</div>
                )}
              </div>
           </div>
           {!isAuthenticated && (
              <button 
                onClick={async () => {
                  const res = await fetch('/api/auth/url');
                  const { url } = await res.json();
                  window.open(url, 'oauth', 'width=600,height=700');
                }}
                className="bg-zinc-900 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest"
              >
                Connect
              </button>
           )}
          <button 
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 p-4 rounded-2xl text-red-500 font-bold hover:bg-red-50 transition-colors"
          >
            <LogOut size={18} />
            Sign Out
          </button>
        </section>

        <button 
          onClick={async () => {
            if (isAuthenticated) {
              await fetch('/api/profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                  age: profile.age, 
                  weight: profile.weight, 
                  height: profile.height 
                })
              });
            }
            onClose();
          }}
          className="w-full py-5 bg-zinc-900 text-white rounded-3xl text-xs font-black uppercase tracking-widest shadow-xl shadow-zinc-200"
        >
          Save & Exit
        </button>
      </div>
    </motion.div>
  );
};

const LogItem = ({ 
  log, 
  onDelete, 
  onEdit 
}: { 
  log: MealLog, 
  onDelete: (id: string) => void, 
  onEdit: (id: string, calories: number) => void 
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(log.calories.toString());

  const handleEdit = () => {
    const val = parseInt(editValue);
    if (!isNaN(val)) {
      onEdit(log.id, val);
    } else {
      setEditValue(log.calories.toString());
    }
    setIsEditing(false);
  };

  return (
    <div className="flex items-center justify-between p-4 border border-zinc-100 rounded-2xl bg-white hover:border-zinc-300 transition-colors group">
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 bg-zinc-50 rounded-2xl overflow-hidden flex items-center justify-center border border-zinc-50">
          {log.image ? <img src={log.image} className="w-full h-full object-cover" /> : <Zap size={18} className="text-zinc-200" />}
        </div>
        <div>
          <div className="font-bold tracking-tight">{log.food_name}</div>
          <div className="text-[10px] text-zinc-400 font-mono italic">{formatTime(log.timestamp)}</div>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          {isEditing ? (
            <input 
              autoFocus
              type="number"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleEdit}
              onKeyDown={(e) => e.key === 'Enter' && handleEdit()}
              className="w-16 bg-zinc-100 border-none p-1 text-right font-black text-lg focus:outline-none rounded-lg"
            />
          ) : (
            <div 
              onClick={() => setIsEditing(true)}
              className="cursor-pointer hover:bg-zinc-50 px-2 rounded-lg transition-colors text-right"
            >
              <div className="font-black text-lg">+{log.calories}</div>
              <div className="text-[9px] uppercase font-bold text-zinc-300">{log.synced ? 'Synced' : 'Local'}</div>
            </div>
          )}
        </div>
        <button 
          onClick={() => onDelete(log.id)}
          className="w-8 h-8 flex items-center justify-center text-zinc-200 hover:text-red-500 hover:bg-red-50 rounded-full transition-all"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
};

const HistoryView = ({ logs, onClose, onDelete, onEdit }: { logs: MealLog[], onClose: () => void, onDelete: (id: string) => void, onEdit: (id: string, calories: number) => void }) => {
  // Group logs by date
  const groupedLogs = logs.reduce((groups: { [key: string]: { logs: MealLog[], total: number } }, log) => {
    const date = new Date(log.timestamp).toLocaleDateString();
    if (!groups[date]) {
      groups[date] = { logs: [], total: 0 };
    }
    groups[date].logs.push(log);
    groups[date].total += log.calories;
    return groups;
  }, {});

  const sortedDates = Object.keys(groupedLogs).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

  return (
    <motion.div 
      initial={{ opacity: 0, x: -100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -100 }}
      className="fixed inset-0 bg-white z-40 p-6 md:p-12 overflow-y-auto"
    >
      <div className="max-w-xl mx-auto space-y-10">
        <header className="flex justify-between items-center">
          <h2 className="text-3xl font-black tracking-tighter uppercase italic">Nutrition History</h2>
          <button onClick={onClose} className="w-10 h-10 bg-zinc-100 rounded-full flex items-center justify-center">
            <X size={20} />
          </button>
        </header>

        <div className="space-y-12">
          {sortedDates.length === 0 ? (
            <div className="text-center py-20 text-zinc-400 italic">No historical data found.</div>
          ) : (
            sortedDates.map((date) => (
              <div key={date} className="space-y-4">
                <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
                  <div className="text-sm font-black uppercase tracking-widest text-zinc-900">{date}</div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-lg font-bold text-zinc-900">{groupedLogs[date].total}</span>
                    <span className="text-[10px] uppercase font-bold text-zinc-400">Total Kcal</span>
                  </div>
                </div>
                
                <div className="space-y-3">
                  {groupedLogs[date].logs.map((log) => (
                    <LogItem 
                      key={log.id} 
                      log={log} 
                      onDelete={onDelete} 
                      onEdit={onEdit} 
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </motion.div>
  );
};
