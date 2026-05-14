export interface UserProfile {
  name: string;
  age: number;
  weight: number; // kg
  height: number; // cm
  gender: 'male' | 'female';
  activityLevel: number; // 1.2 to 1.9
}

export interface MealLog {
  id: string;
  food_name: string;
  calories: number;
  timestamp: string;
  image?: string;
  synced?: boolean;
}

export const ACTIVITY_LEVELS = [
  { label: 'Sedentary (Office job)', value: 1.2 },
  { label: 'Lightly Active', value: 1.375 },
  { label: 'Moderately Active', value: 1.55 },
  { label: 'Very Active', value: 1.725 },
  { label: 'Extra Active', value: 1.9 },
];
