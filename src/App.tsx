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
  Cloud,
  Sparkles,
  MapPin
} from 'lucide-react';
import { GoogleGenAI, Type } from "@google/genai";
import { UserProfile, MealLog, WorkoutLog, ACTIVITY_LEVELS } from './types';

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

const getCalorieGoalInfo = (profile: UserProfile): { dailyTarget: number, advice: string, isUnreachable: boolean, suggestions: { name: string, calories: number }[] } => {
  const tdee = calculateBMR(profile);
  if (!profile.targetWeight || !profile.targetDate) {
    return { dailyTarget: tdee, advice: "Set a target weight to get a custom goal.", isUnreachable: false, suggestions: [] };
  }

  const weightDiff = profile.weight - profile.targetWeight; // positive means lose weight
  const totalCaloriesDiff = weightDiff * 7700;
  
  const targetDate = new Date(profile.targetDate);
  const today = new Date();
  const daysLeft = Math.ceil((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (daysLeft <= 0) {
    return { dailyTarget: tdee, advice: "Target date reached! Update your goal.", isUnreachable: false, suggestions: [] };
  }

  const dailyDeficitNeeded = totalCaloriesDiff / daysLeft;
  const dailyTarget = Math.round(tdee - dailyDeficitNeeded);

  let advice = "";
  let isUnreachable = false;
  let suggestions: { name: string, calories: number }[] = [];

  // Minimum safe calories
  const minCalories = profile.gender === 'male' ? 1500 : 1200;

  if (dailyTarget < minCalories) {
    isUnreachable = true;
    const deficitToCover = minCalories - dailyTarget;
    if (deficitToCover < 300) {
      advice = `Aggressive goal. To stay safe, eat ${minCalories} kcal and add 45 mins of brisk walking or 30 mins of light cycling daily.`;
      suggestions = [
        { name: "45 mins of Brisk Walking", calories: 150 },
        { name: "30 mins of Light Cycling", calories: 200 }
      ];
    } else if (deficitToCover < 600) {
      advice = `High intensity required. Eat ${minCalories} kcal and add 45 mins of high intensity cardio (e.g., Running @ 9km/h or HIIT) to reach this goal.`;
      suggestions = [
        { name: "45 mins of Running (9km/h)", calories: 450 },
        { name: "45 mins of HIIT Workout", calories: 400 },
        { name: "30 mins of Heavy Swimming", calories: 350 }
      ];
    } else {
      advice = `Too aggressive. You'd need to burn ${deficitToCover} extra kcal daily. Add 60 mins of biking or swimming, or extend your target date.`;
      suggestions = [
        { name: "60 mins of Biking", calories: 500 },
        { name: "60 mins of Swimming", calories: 600 },
        { name: "45 mins of Jump Rope", calories: 500 }
      ];
    }
  } else if (Math.abs(dailyDeficitNeeded) > 1000) {
    advice = "Large deficit. To maintain muscle, perform 30-45 mins of strength training 3x a week along with your diet.";
    suggestions = [
      { name: "45 mins of Strength Training", calories: 250 }
    ];
  } else {
    advice = weightDiff > 0 ? "You're on track to lose weight!" : "Focusing on muscle gain?";
  }

  return { dailyTarget: Math.max(dailyTarget, minCalories), advice, isUnreachable, suggestions };
};

const getMealRecommendation = async (profile: UserProfile, targetMacros: { protein: number, carbs: number, fat: number, calories: number }, logs: MealLog[]) => {
  const currentHour = new Date().getHours();
  let mealType = "Snack";
  if (currentHour >= 5 && currentHour < 11) mealType = "Breakfast";
  else if (currentHour >= 11 && currentHour < 16) mealType = "Lunch";
  else if (currentHour >= 16 && currentHour < 22) mealType = "Dinner";

  const dailyEaten = logs
    .filter(log => new Date(log.timestamp).toDateString() === new Date().toDateString())
    .reduce((sums, log) => ({
      protein: sums.protein + (log.protein || 0),
      carbs: sums.carbs + (log.carbs || 0),
      fat: sums.fat + (log.fat || 0),
      calories: sums.calories + log.calories
    }), { protein: 0, carbs: 0, fat: 0, calories: 0 });

  const remaining = {
    protein: Math.max(0, targetMacros.protein - dailyEaten.protein),
    carbs: Math.max(0, targetMacros.carbs - dailyEaten.carbs),
    fat: Math.max(0, targetMacros.fat - dailyEaten.fat),
    calories: Math.max(0, targetMacros.calories - dailyEaten.calories)
  };

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const prompt = `User is in ${profile.country || 'USA'}. It is currently ${mealType} time. 
    Target daily macros: Protein ${targetMacros.protein}g, Carbs ${targetMacros.carbs}g, Fat ${targetMacros.fat}g, Calories ${targetMacros.calories}kcal.
    Already eaten today: Protein ${dailyEaten.protein}g, Carbs ${dailyEaten.carbs}g, Fat ${dailyEaten.fat}g, Calories ${dailyEaten.calories}kcal.
    Remaining budget: Protein ${remaining.protein}g, Carbs ${remaining.carbs}g, Fat ${remaining.fat}g, Calories ${remaining.calories}kcal.
    Suggest a specific, popular dish from ${profile.country || 'USA'} for ${mealType} that helps balance these remaining macros.
    Provide the dish name and estimated macros for a typical portion that fits the remaining budget.`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            dish_name: { type: Type.STRING },
            reason: { type: Type.STRING },
            protein: { type: Type.INTEGER },
            carbs: { type: Type.INTEGER },
            fat: { type: Type.INTEGER },
            calories: { type: Type.INTEGER }
          },
          required: ["dish_name", "reason", "protein", "carbs", "fat", "calories"]
        }
      }
    });

    return JSON.parse(response.text);
  } catch (e) {
    console.error("Meal Recommendation Error:", e);
    return null;
  }
};

const ProgressBar = ({ current, total, advice, pcf }: { current: number, total: number, advice?: string, pcf: { protein: number, carbs: number, fat: number } }) => {
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
      <div className="h-6 bg-zinc-100 rounded-full overflow-hidden p-1 border border-zinc-200 mb-2">
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          className={`h-full rounded-full ${isOverflow ? 'bg-red-500' : 'bg-lime-400 opacity-90'}`}
        />
      </div>
      <div className="flex gap-3 px-1">
        <div className="flex items-baseline gap-1">
          <span className="text-[10px] font-mono font-bold text-zinc-900">{pcf.protein}g</span>
          <span className="text-[8px] uppercase font-bold text-zinc-400">Protein</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-[10px] font-mono font-bold text-zinc-900">{pcf.carbs}g</span>
          <span className="text-[8px] uppercase font-bold text-zinc-400">Carbs</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-[10px] font-mono font-bold text-zinc-900">{pcf.fat}g</span>
          <span className="text-[8px] uppercase font-bold text-zinc-400">Fat</span>
        </div>
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
      activityLevel: 1.375,
      country: 'USA'
    };
  });
  
  const [logs, setLogs] = useState<MealLog[]>(() => {
    const saved = localStorage.getItem('cl_logs');
    return saved ? JSON.parse(saved) : [];
  });

  const [workouts, setWorkouts] = useState<WorkoutLog[]>(() => {
    const saved = localStorage.getItem('cl_workouts');
    return saved ? JSON.parse(saved) : [];
  });

  const [initialImage, setInitialImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
    localStorage.setItem('cl_workouts', JSON.stringify(workouts));
  }, [workouts]);

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
          protein: l.protein,
          carbs: l.carbs,
          fat: l.fat,
          timestamp: l.createdAt,
          image: l.imageUrl,
          synced: true
        }));
        
        setLogs(prev => {
          const unsynced = prev.filter(l => !l.synced);
          return [...unsynced, ...cloudLogs];
        });
      }

      const workoutsRes = await fetch('/api/workouts');
      const workoutsData = await workoutsRes.json();
      if (Array.isArray(workoutsData)) {
        const cloudWorkouts = workoutsData.map((w: any) => ({
          id: String(w.id),
          type: w.type,
          calories_burned: w.caloriesBurned,
          timestamp: w.createdAt,
          synced: true
        }));

        setWorkouts(prev => {
          const unsynced = prev.filter(w => !w.synced);
          return [...unsynced, ...cloudWorkouts];
        });
      }
      
      setTimeout(syncUnsyncedLogs, 1000);
      setTimeout(syncUnsyncedWorkouts, 1000);
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

  const syncUnsyncedWorkouts = async () => {
    const unsynced = workouts.filter(w => !w.synced);
    if (unsynced.length === 0 || !isAuthenticated) return;

    setIsSyncing(true);
    try {
      const res = await fetch('/api/workouts/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workouts: unsynced })
      });
      const data = await res.json();
      if (data.success) {
        const syncedIds = new Set(data.synced.map((s: any) => s.localId));
        setWorkouts(prev => prev.map(w => syncedIds.has(w.id) ? { ...w, synced: true } : w));
      }
    } catch (e) {
      console.error("Workout Sync Error:", e);
    } finally {
      setIsSyncing(false);
    }
  };

  const addWorkout = async (type: string, calories: number) => {
    const newWorkout: WorkoutLog = {
      id: Date.now().toString(),
      type,
      calories_burned: calories,
      timestamp: new Date().toISOString(),
      synced: false
    };

    setWorkouts([newWorkout, ...workouts]);

    if (isAuthenticated) {
      try {
        const res = await fetch('/api/workouts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type,
            caloriesBurned: calories,
            createdAt: newWorkout.timestamp
          })
        });
        const data = await res.json();
        if (data.id) {
          setWorkouts(prev => prev.map(w => w.id === newWorkout.id ? { ...w, id: String(data.id), synced: true } : w));
        }
      } catch (e) {
        console.error("Add Workout Error:", e);
      }
    }
  };

  const removeWorkoutLog = async (id: string) => {
    const isServerId = /^\d+$/.test(id);
    if (isAuthenticated && isServerId) {
      try {
        await fetch(`/api/workouts/${id}`, { method: 'DELETE' });
      } catch (e) {
        console.error("Delete Workout Error:", e);
      }
    }
    setWorkouts(prev => prev.filter(w => w.id !== id));
  };

  const dailyEaten = logs
    .filter(log => new Date(log.timestamp).toDateString() === new Date().toDateString())
    .reduce((sum, log) => sum + log.calories, 0);

  const dailyBurned = workouts
    .filter(w => new Date(w.timestamp).toDateString() === new Date().toDateString())
    .reduce((sum, w) => sum + w.calories_burned, 0);

  const dailyCalories = dailyEaten - dailyBurned;

  const goalInfo = getCalorieGoalInfo(profile);
  const calorieBudget = goalInfo.dailyTarget;
  
  const pcfBudget = {
    protein: Math.round((calorieBudget * 0.3) / 4),
    carbs: Math.round((calorieBudget * 0.4) / 4),
    fat: Math.round((calorieBudget * 0.3) / 9)
  };

  const [recommendation, setRecommendation] = useState<any>(null);
  const [isRefreshingRec, setIsRefreshingRec] = useState(false);

  useEffect(() => {
    const fetchRec = async () => {
      setIsRefreshingRec(true);
      const rec = await getMealRecommendation(profile, { ...pcfBudget, calories: calorieBudget }, logs);
      setRecommendation(rec);
      setIsRefreshingRec(false);
    };
    if (view === 'dashboard') {
      fetchRec();
    }
  }, [view, calorieBudget, logs.length, profile.country]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setInitialImage(reader.result as string);
        setView('camera');
      };
      reader.readAsDataURL(file);
    }
  };

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
                <ProgressBar current={dailyCalories} total={calorieBudget} advice={goalInfo.advice} pcf={pcfBudget} />
                
                {recommendation && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-8 p-6 bg-zinc-900 rounded-3xl text-white relative overflow-hidden group"
                  >
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                      <Sparkles size={40} />
                    </div>
                    <div className="text-[10px] uppercase font-black tracking-widest text-lime-400 mb-2 flex items-center gap-2">
                       <div className="w-1.5 h-1.5 bg-lime-400 rounded-full animate-pulse"></div>
                       AI Smart Recommendation
                    </div>
                    <h4 className="text-xl font-bold mb-1">{recommendation.dish_name}</h4>
                    <p className="text-[10px] text-zinc-400 mb-4 font-medium leading-relaxed">{recommendation.reason}</p>
                    <div className="flex gap-4 border-t border-white/10 pt-4">
                      <div className="text-center">
                        <div className="text-xs font-bold">{recommendation.calories}</div>
                        <div className="text-[8px] uppercase font-bold text-zinc-500">Kcal</div>
                      </div>
                      <div className="text-center">
                        <div className="text-xs font-bold">{recommendation.protein}g</div>
                        <div className="text-[8px] uppercase font-bold text-zinc-500">P</div>
                      </div>
                      <div className="text-center">
                        <div className="text-xs font-bold">{recommendation.carbs}g</div>
                        <div className="text-[8px] uppercase font-bold text-zinc-500">C</div>
                      </div>
                      <div className="text-center">
                        <div className="text-xs font-bold">{recommendation.fat}g</div>
                        <div className="text-[8px] uppercase font-bold text-zinc-500">F</div>
                      </div>
                      <button 
                        disabled={isRefreshingRec}
                        onClick={async () => {
                          setIsRefreshingRec(true);
                          const rec = await getMealRecommendation(profile, { ...pcfBudget, calories: calorieBudget }, logs);
                          setRecommendation(rec);
                          setIsRefreshingRec(false);
                        }}
                        className="ml-auto text-lime-400 hover:text-lime-300 transition-colors disabled:opacity-50"
                      >
                         <History size={16} className={isRefreshingRec ? 'animate-spin' : ''} />
                      </button>
                    </div>
                  </motion.div>
                )}

                {goalInfo.suggestions.length > 0 && (
                  <div className="mt-8 space-y-4">
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Survival Checklist</h3>
                    <div className="grid grid-cols-1 gap-2">
                       {goalInfo.suggestions.map((s, i) => {
                         const isDone = workouts.some(w => 
                           new Date(w.timestamp).toDateString() === new Date().toDateString() && 
                           w.type === s.name
                         );
                         return (
                           <button 
                             key={i}
                             onClick={() => isDone ? removeWorkoutLog(workouts.find(w => w.type === s.name && new Date(w.timestamp).toDateString() === new Date().toDateString())!.id) : addWorkout(s.name, s.calories)}
                             className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${isDone ? 'bg-lime-50 border-lime-200 text-lime-900' : 'bg-white border-zinc-100 text-zinc-600 hover:border-zinc-300'}`}
                           >
                             <div className="flex items-center gap-3 text-xs font-bold">
                               <div className={`w-5 h-5 rounded-md flex items-center justify-center border ${isDone ? 'bg-lime-400 border-lime-500 text-white' : 'border-zinc-200'}`}>
                                 {isDone && <Check size={14} strokeWidth={4} />}
                               </div>
                               {s.name}
                             </div>
                             <span className="text-[10px] font-mono font-black opacity-40">-{s.calories}kcal</span>
                           </button>
                         );
                       })}
                    </div>
                  </div>
                )}

                {goalInfo.advice && (
                  <div className={`mt-6 p-4 rounded-2xl flex items-start gap-3 border ${goalInfo.isUnreachable ? 'bg-orange-50 border-orange-100 text-orange-900' : 'bg-lime-50 border-lime-100 text-lime-900'}`}>
                    <div className="mt-0.5">
                      <Zap size={14} className={goalInfo.isUnreachable ? 'text-orange-500' : 'text-lime-500'} />
                    </div>
                    <div className="text-[11px] leading-relaxed font-medium">
                      {goalInfo.advice}
                    </div>
                  </div>
                )}
              </section>

              {/* Quick Actions */}
              <div className="flex gap-4">
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileUpload} 
                  accept="image/*" 
                  className="hidden" 
                />
                <button 
                  onClick={() => {
                    setInitialImage(null);
                    setView('camera');
                  }}
                  className="flex-1 bg-zinc-900 text-white p-6 rounded-3xl flex flex-col items-center justify-center gap-3 hover:scale-[0.98] transition-transform active:scale-95 group relative overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-tr from-lime-500/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                  <Camera size={24} />
                  <span className="font-bold uppercase tracking-wider text-[10px]">Snap Meal</span>
                </button>
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 bg-zinc-100 text-zinc-900 p-6 rounded-3xl flex flex-col items-center justify-center gap-3 hover:scale-[0.98] transition-transform active:scale-95 group relative overflow-hidden border border-zinc-200"
                >
                  <Upload size={24} className="text-zinc-400 group-hover:text-zinc-900 transition-colors" />
                  <span className="font-bold uppercase tracking-wider text-[10px]">Upload</span>
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
                  <button 
                    onClick={() => setView('history')} 
                    className="text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-zinc-900 transition-colors flex items-center gap-1"
                  >
                    Show More <ChevronRight size={14} />
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
            initialImage={initialImage}
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

const CameraView = ({ onClose, onLog, initialImage }: { onClose: () => void, onLog: (l: MealLog) => void, initialImage?: string | null }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(initialImage || null);
  const [isLoading, setIsLoading] = useState(false);
  const [analysis, setAnalysis] = useState<any>(null);

  useEffect(() => {
    if (initialImage) {
      analyzeImage(initialImage);
    } else {
      startCamera();
    }
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
              { text: "Identify this food and provide estimated calories, protein (g), carbs (g), and fat (g)." }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              food_name: { type: Type.STRING },
              calories: { type: Type.INTEGER },
              protein: { type: Type.INTEGER },
              carbs: { type: Type.INTEGER },
              fat: { type: Type.INTEGER }
            },
            required: ["food_name", "calories", "protein", "carbs", "fat"]
          }
        }
      });
      
      const text = response.text;
      const data = JSON.parse(text);
      setAnalysis(data);
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
                    <div className="flex gap-4 pt-4">
                      <div className="text-center">
                        <div className="text-sm font-bold">{analysis?.protein || 0}g</div>
                        <div className="text-[9px] uppercase font-bold text-zinc-400">Protein</div>
                      </div>
                      <div className="text-center">
                        <div className="text-sm font-bold">{analysis?.carbs || 0}g</div>
                        <div className="text-[9px] uppercase font-bold text-zinc-400">Carbs</div>
                      </div>
                      <div className="text-center">
                        <div className="text-sm font-bold">{analysis?.fat || 0}g</div>
                        <div className="text-[9px] uppercase font-bold text-zinc-400">Fat</div>
                      </div>
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
                        protein: analysis.protein,
                        carbs: analysis.carbs,
                        fat: analysis.fat,
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
                onChange={(e) => onChange({ ...profile, weight: parseFloat(e.target.value) || 0 })}
                className="w-full bg-zinc-50 p-4 rounded-2xl text-xl font-bold border-transparent focus:border-zinc-900 focus:outline-none transition-all"
              />
            </div>
            <div className="space-y-1">
               <label className="text-[10px] uppercase font-bold text-zinc-400 tracking-widest">Height (CM)</label>
               <input 
                type="number" 
                value={profile.height} 
                onChange={(e) => onChange({ ...profile, height: parseFloat(e.target.value) || 0 })}
                className="w-full bg-zinc-50 p-4 rounded-2xl text-xl font-bold border-transparent focus:border-zinc-900 focus:outline-none transition-all"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-zinc-400 tracking-widest">Age</label>
              <input 
                type="number" 
                value={profile.age} 
                onChange={(e) => onChange({ ...profile, age: parseInt(e.target.value) || 0 })}
                className="w-full bg-zinc-50 p-4 rounded-2xl text-xl font-bold border-transparent focus:border-zinc-900 focus:outline-none transition-all"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-zinc-400 tracking-widest">Gender</label>
              <div className="flex bg-zinc-50 p-1 rounded-2xl h-[60px]">
                <button 
                  onClick={() => onChange({ ...profile, gender: 'male' })}
                  className={`flex-1 rounded-xl font-bold text-sm transition-all ${profile.gender === 'male' ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-400'}`}
                >
                  Male
                </button>
                <button 
                  onClick={() => onChange({ ...profile, gender: 'female' })}
                  className={`flex-1 rounded-xl font-bold text-sm transition-all ${profile.gender === 'female' ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-400'}`}
                >
                  Female
                </button>
              </div>
            </div>
          </div>

          <div className="p-6 bg-zinc-900 rounded-[2.5rem] text-white space-y-6">
            <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500">Goal Settings</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[9px] uppercase font-bold text-zinc-500 tracking-widest">Target Weight (KG)</label>
                <input 
                  type="number" 
                  value={profile.targetWeight || ''} 
                  placeholder="70"
                  onChange={(e) => onChange({ ...profile, targetWeight: parseFloat(e.target.value) || undefined })}
                  className="w-full bg-white/10 p-4 rounded-2xl text-xl font-bold border-transparent focus:border-white focus:outline-none transition-all"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] uppercase font-bold text-zinc-500 tracking-widest">Target Date</label>
                <input 
                  type="date" 
                  value={profile.targetDate || ''} 
                  onChange={(e) => onChange({ ...profile, targetDate: e.target.value })}
                  className="w-full bg-white/10 p-4 rounded-2xl text-sm font-bold border-transparent focus:border-white focus:outline-none transition-all h-[60px]"
                />
              </div>
            </div>
            
            <div className="space-y-1">
              <label className="text-[9px] uppercase font-bold text-zinc-500 tracking-widest">Location / Country</label>
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500">
                  <MapPin size={16} />
                </div>
                <input 
                  type="text" 
                  value={profile.country || ''} 
                  placeholder="e.g. Philippines, USA, UK"
                  onChange={(e) => onChange({ ...profile, country: e.target.value })}
                  className="w-full bg-white/10 p-4 pl-12 rounded-2xl text-lg font-bold border-transparent focus:border-white focus:outline-none transition-all"
                />
              </div>
              <p className="text-[10px] text-zinc-500 italic px-2">Used to suggest local, healthy meals for your specific region.</p>
            </div>
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
                  height: profile.height,
                  gender: profile.gender,
                  activityLevel: profile.activityLevel,
                  targetWeight: profile.targetWeight,
                  targetDate: profile.targetDate,
                  country: profile.country
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
          <div className="text-[10px] text-zinc-400 font-mono italic mb-1">{formatTime(log.timestamp)}</div>
          <div className="flex gap-2">
            <span className="text-[9px] text-zinc-400 border border-zinc-100 px-1 rounded">P: {log.protein || 0}g</span>
            <span className="text-[9px] text-zinc-400 border border-zinc-100 px-1 rounded">C: {log.carbs || 0}g</span>
            <span className="text-[9px] text-zinc-400 border border-zinc-100 px-1 rounded">F: {log.fat || 0}g</span>
          </div>
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
  const groupedLogs = logs.reduce((groups: { [key: string]: { logs: MealLog[], total: number, protein: number, carbs: number, fat: number } }, log) => {
    const date = new Date(log.timestamp).toLocaleDateString();
    if (!groups[date]) {
      groups[date] = { logs: [], total: 0, protein: 0, carbs: 0, fat: 0 };
    }
    groups[date].logs.push(log);
    groups[date].total += log.calories;
    groups[date].protein += (log.protein || 0);
    groups[date].carbs += (log.carbs || 0);
    groups[date].fat += (log.fat || 0);
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
                  <div className="flex flex-col items-end">
                    <div className="flex items-baseline gap-1">
                      <span className="text-lg font-bold text-zinc-900">{groupedLogs[date].total}</span>
                      <span className="text-[10px] uppercase font-bold text-zinc-400">Total Kcal</span>
                    </div>
                    <div className="flex gap-2 -mt-1">
                      <span className="text-[9px] text-zinc-400 font-bold">P: {groupedLogs[date].protein}g</span>
                      <span className="text-[9px] text-zinc-400 font-bold">C: {groupedLogs[date].carbs}g</span>
                      <span className="text-[9px] text-zinc-400 font-bold">F: {groupedLogs[date].fat}g</span>
                    </div>
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
