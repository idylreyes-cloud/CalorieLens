export interface UserProfile {
  id: string;
  name: string;
  age: number;
  weight: number; // kg
  height: number; // cm
  gender: 'male' | 'female';
  activityLevel: number; // 1.2 to 1.9
  targetWeight?: number;
  targetDate?: string;
  country?: string;
  avatarColor?: string;
}

export interface MealLog {
  id: string;
  profileId: string;
  food_name: string;
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  timestamp: string;
  image?: string;
}

export interface WorkoutLog {
  id: string;
  profileId: string;
  type: string;
  calories_burned: number;
  timestamp: string;
}

export const ACTIVITY_LEVELS = [
  { label: 'Sedentary (Office job)', value: 1.2 },
  { label: 'Lightly Active', value: 1.375 },
  { label: 'Moderately Active', value: 1.55 },
  { label: 'Very Active', value: 1.725 },
  { label: 'Extra Active', value: 1.9 },
];
