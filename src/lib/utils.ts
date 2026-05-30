import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export const formatTime = (seconds) => {
  if (!seconds && seconds !== 0) return '00:00:00'
  const hrs = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

export const formatDate = (date) => {
  if (!date) return ''
  return new Date(date).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export const generateApplicationId = (existingIds = []) => {
  const maxNum = existingIds.reduce((max, id) => {
    const match = id?.match(/HRTA(\d+)/)
    return match ? Math.max(max, parseInt(match[1])) : max
  }, 0)
  return `HRTA${String(maxNum + 1).padStart(3, '0')}`
}
