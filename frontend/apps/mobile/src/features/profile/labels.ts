import type Ionicons from '@expo/vector-icons/Ionicons'
import type { Activity, Experience, Goal, Pace, Phase, Place, Sex, Split } from '@liftlog/domain'
import type { ComponentProps } from 'react'

type IconName = ComponentProps<typeof Ionicons>['name']

interface Choice {
  title: string
  body: string
  icon?: IconName
}

export const SEX_CHOICES: Record<Sex, Choice> = {
  male: { title: 'Male', body: 'Used only to estimate your energy needs', icon: 'male' },
  female: { title: 'Female', body: 'Used only to estimate your energy needs', icon: 'female' },
}

export const GOAL_CHOICES: Record<Goal, Choice> = {
  loseFat: { title: 'Lose fat', body: 'Get leaner and keep your muscle', icon: 'flame' },
  buildMuscle: { title: 'Build muscle', body: 'Add size where it counts', icon: 'body' },
  getStronger: { title: 'Get stronger', body: 'Move more weight on the big lifts', icon: 'barbell' },
  stayFit: { title: 'Stay fit', body: 'Feel good, move well, stay consistent', icon: 'heart' },
}

export const EXPERIENCE_CHOICES: Record<Experience, Choice> = {
  new: { title: 'Brand new', body: 'Never followed a program' },
  beginner: { title: 'Beginner', body: 'Under a year of regular training' },
  intermediate: { title: 'Intermediate', body: '1 to 3 years, know the main lifts' },
  advanced: { title: 'Advanced', body: '3+ years, progress comes slowly' },
}

export const PLACE_CHOICES: Record<Place, Choice> = {
  gym: { title: 'Gym', body: 'Barbells, machines, cables', icon: 'business' },
  home: { title: 'Home', body: 'Dumbbells, a bench, maybe a bar', icon: 'home' },
  bodyweight: { title: 'Anywhere', body: 'No equipment, just you', icon: 'walk' },
}

export const ACTIVITY_CHOICES: Record<Activity, Choice> = {
  desk: { title: 'Mostly sitting', body: 'Desk job, study, driving', icon: 'desktop' },
  onFeet: { title: 'On my feet', body: 'Retail, teaching, lots of walking', icon: 'footsteps' },
  physical: { title: 'Physical work', body: 'Construction, warehouse, farm', icon: 'construct' },
}

export const PACE_CHOICES: Record<Pace, Choice> = {
  steady: { title: 'Steady', body: 'Easiest to stick to', icon: 'leaf' },
  standard: { title: 'Balanced', body: 'Recommended for most people', icon: 'speedometer' },
  fast: { title: 'Aggressive', body: 'Harder, best for short pushes', icon: 'flash' },
}

export const PHASE_LABEL: Record<Phase, { title: string; body: string }> = {
  cut: {
    title: 'Fat loss',
    body: 'A moderate deficit with high protein keeps muscle while the fat comes off.',
  },
  recomp: {
    title: 'Recomposition',
    body: 'Eat near maintenance: build muscle and lose fat at the same time.',
  },
  maintain: { title: 'Maintenance', body: 'Eat at maintenance and let training drive the change.' },
  leanBulk: { title: 'Lean bulk', body: 'A small surplus fuels new muscle with minimal fat gain.' },
}

export const SPLIT_LABEL: Record<Split, { title: string; body: string }> = {
  fullBody: { title: 'Full body', body: 'Every muscle, every session' },
  upperLower: { title: 'Upper / Lower', body: 'Alternate upper and lower days' },
  hybrid: { title: 'Upper / Lower + PPL', body: 'Two upper/lower days, then push, pull, legs' },
  pushPullLegs: { title: 'Push / Pull / Legs', body: 'Each pattern twice a week' },
}
