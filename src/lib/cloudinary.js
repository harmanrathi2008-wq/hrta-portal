// Cloudinary configuration
const CLOUDINARY_CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || 'dayxiswon'
const CLOUDINARY_UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || 'hrta_uploads'

/**
 * Upload an image to Cloudinary
 * @param {File} file - The image file to upload
 * @returns {Promise<{url: string, public_id: string}>}
 */
export const uploadImageToCloudinary = async (file) => {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET)

  try {
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
      { method: 'POST', body: formData }
    )
    
    const data = await response.json()
    
    if (!response.ok) {
      throw new Error(data.error?.message || 'Upload failed')
    }
    
    return {
      url: data.secure_url,
      public_id: data.public_id
    }
  } catch (error) {
    console.error('Cloudinary upload error:', error)
    throw error
  }
}

/**
 * Delete an image from Cloudinary
 * @param {string} publicId - The public_id of the image to delete
 * @returns {Promise<boolean>}
 */
export const deleteImageFromCloudinary = async (publicId) => {
  try {
    const response = await fetch('/api/delete-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_id: publicId })
    })
    
    return response.ok
  } catch (error) {
    console.error('Cloudinary delete error:', error)
    return false
  }
}

/**
 * Get optimized image URL with transformations
 * @param {string} url - Original Cloudinary URL
 * @param {number} width - Desired width (optional)
 * @param {number} height - Desired height (optional)
 * @returns {string}
 */
export const getOptimizedImageUrl = (url, width = 800, height = null) => {
  if (!url) return ''
  
  // Split the URL to add transformations
  const parts = url.split('/upload/')
  if (parts.length < 2) return url
  
  let transformation = `w_${width},c_limit,q_auto,f_webp`
  if (height) {
    transformation += `,h_${height}`
  }
  
  return `${parts[0]}/upload/${transformation}/${parts[1]}`
}
