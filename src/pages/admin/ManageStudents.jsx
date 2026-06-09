import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

const ManageStudents = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Modal & Form State
  const [showAddModal, setShowAddModal] = useState(false);
  const [saving, setSaving] = useState(false);
  
  const [formData, setFormData] = useState({
    full_name: '',
    email: '',
    date_of_birth: '',
    phone: '',
    category: 'General'
  });
  
  // Image Upload State
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');

  // Fetch Students
  useEffect(() => {
    fetchStudents();
  }, [navigate]);

  const fetchStudents = async () => {
    try {
      const role = sessionStorage.getItem('role');
      if (role !== 'super_admin') {
        navigate('/');
        return;
      }
      
      const { data, error } = await supabase
        .from('students')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setStudents(data || []);
    } catch (err) {
      console.error("Error fetching students:", err);
    } finally {
      setLoading(false);
    }
  };

  // --- Image Upload Logic ---
  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        alert("Image size must be less than 2MB");
        return;
      }
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const uploadImageToCloudinary = async (base64Image) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      const loginLogId = sessionStorage.getItem('loginLogId') || '';

      const apiBaseUrl = import.meta.env.VITE_API_URL || 'https://hrta-portal.onrender.com';
      const response = await fetch(`${apiBaseUrl}/api/upload-image`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Session-ID': loginLogId
        },
        body: JSON.stringify({ image: base64Image })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      return data.secure_url || data.url;
    } catch (err) {
      console.error("Cloudinary upload failed:", err);
      throw err;
    }
  };

  // --- Student Creation Logic ---
  const generateApplicationId = () => {
    if (students.length === 0) return 'HRTA001';
    
    // Find the highest number in existing application IDs
    let maxId = 0;
    students.forEach(s => {
      if (s.application_id && s.application_id.startsWith('HRTA')) {
        const numPart = parseInt(s.application_id.replace('HRTA', ''), 10);
        if (!isNaN(numPart) && numPart > maxId) {
          maxId = numPart;
        }
      }
    });
    
    return `HRTA${(maxId + 1).toString().padStart(3, '0')}`;
  };

  const handleAddStudent = async (e) => {
    e.preventDefault();
    setSaving(true);
    
    try {
      // 1. Upload Photo if selected
      let photoUrl = null;
      if (imagePreview) {
        photoUrl = await uploadImageToCloudinary(imagePreview);
      }

      // 2. Generate Application ID
      const newAppId = generateApplicationId();

      // 3. Build Payload DYNAMICALLY to avoid schema cache errors
      const newStudent = {
        application_id: newAppId,
        full_name: formData.full_name,
        email: formData.email,
        date_of_birth: formData.date_of_birth,
        phone: formData.phone,
        category: formData.category,
        status: 'active'
      };

      // ONLY append photo_url if we actually have an image!
      if (photoUrl) {
        newStudent.photo_url = photoUrl;
      }

      // 4. Save to Supabase
      const { data, error } = await supabase.from('students').insert([newStudent]).select().single();
      
      if (error) throw error;

      // Update UI
      setStudents([data, ...students]);
      setShowAddModal(false);
      resetForm();
      alert(`Student added successfully! App ID: ${newAppId}`);

    } catch (err) {
      console.error("Add student error:", err);
      if (err.message && err.message.includes('schema cache')) {
        alert("DATABASE ERROR: You need to add the 'photo_url' column to your 'students' table in Supabase. Please run the SQL command provided.");
      } else {
        alert(err.message || "Failed to add student. Ensure email is unique.");
      }
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setFormData({ full_name: '', email: '', date_of_birth: '', phone: '', category: 'General' });
    setImageFile(null);
    setImagePreview('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // --- Actions ---
  const toggleStudentStatus = async (id, currentStatus) => {
    const newStatus = currentStatus === 'active' ? 'disabled' : 'active';
    try {
      const { error } = await supabase.from('students').update({ status: newStatus }).eq('id', id);
      if (error) throw error;
      setStudents(students.map(s => s.id === id ? { ...s, status: newStatus } : s));
    } catch (err) {
      alert("Failed to update status.");
    }
  };

  const deleteStudent = async (id, name) => {
    if (!window.confirm(`WARNING: Are you sure you want to PERMANENTLY delete ${name}? This will erase all their exam results, history, and logs.`)) {
      return;
    }
    try {
      const { error } = await supabase.from('students').delete().eq('id', id);
      if (error) throw error;
      setStudents(students.filter(s => s.id !== id));
    } catch (err) {
      alert("Failed to delete student. They may have dependent records that need deleting first.");
    }
  };

  // Filtering
  const filteredStudents = students.filter(s => 
    s.full_name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    s.application_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) return <div className="p-8 text-[#005fa7] font-bold">Loading Candidate Database...</div>;

  return (
    <div className="min-h-screen bg-gray-50 font-sans pb-12">
      
      {/* Header */}
      <div className="bg-white border-b border-gray-300 shadow-sm px-8 py-6 mb-8">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center">
          <div>
            <Link to="/admin/dashboard" className="text-[#005fa7] hover:underline text-sm font-semibold mb-2 inline-block">&larr; Back to Dashboard</Link>
            <h1 className="text-2xl font-black text-[#005fa7] tracking-tight">Candidate Database</h1>
            <p className="text-sm font-bold text-gray-500 mt-1">Manage registered students, upload photos, and control access.</p>
          </div>
          <div className="mt-4 md:mt-0 flex gap-3">
            <button 
              onClick={() => setShowAddModal(true)}
              className="bg-[#005fa7] hover:bg-[#004b87] text-white px-5 py-2.5 rounded font-bold shadow-sm transition-colors text-sm uppercase"
            >
              + Register New Student
            </button>
            <button 
              className="bg-white hover:bg-gray-50 text-[#005fa7] border border-[#005fa7] px-5 py-2.5 rounded font-bold shadow-sm transition-colors text-sm uppercase"
              onClick={() => alert("Bulk CSV Upload interface goes here.")}
            >
              Upload CSV
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Search & Filter Bar */}
        <div className="bg-white p-4 rounded shadow-sm border border-gray-300 mb-6 flex justify-between items-center">
          <input 
            type="text" 
            placeholder="Search by Name, App ID, or Email..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full max-w-md px-4 py-2 border border-gray-300 rounded focus:outline-none focus:border-[#005fa7]"
          />
          <div className="text-sm font-bold text-gray-500">
            Total Records: <span className="text-[#005fa7]">{filteredStudents.length}</span>
          </div>
        </div>

        {/* Data Table */}
        <div className="bg-white shadow-sm border border-gray-300 rounded overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-gray-100 border-b border-gray-300">
                <tr>
                  <th className="px-6 py-3 text-xs font-bold text-gray-600 uppercase tracking-wider">Profile</th>
                  <th className="px-6 py-3 text-xs font-bold text-gray-600 uppercase tracking-wider">App ID & Name</th>
                  <th className="px-6 py-3 text-xs font-bold text-gray-600 uppercase tracking-wider">Contact Details</th>
                  <th className="px-6 py-3 text-xs font-bold text-gray-600 uppercase tracking-wider">DOB & Category</th>
                  <th className="px-6 py-3 text-xs font-bold text-gray-600 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-xs font-bold text-gray-600 uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredStudents.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="px-6 py-12 text-center text-gray-500 font-medium">
                      No candidates found matching your search.
                    </td>
                  </tr>
                ) : (
                  filteredStudents.map((student) => (
                    <tr key={student.id} className="hover:bg-blue-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        {student.photo_url ? (
                          <img src={student.photo_url} alt="Profile" className="h-12 w-12 rounded object-cover border border-gray-300 shadow-sm" />
                        ) : (
                          <div className="h-12 w-12 rounded bg-gray-200 border border-gray-300 flex items-center justify-center text-gray-400 font-bold text-xs">
                            No Pic
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-black text-[#005fa7]">{student.application_id}</div>
                        <div className="text-sm font-bold text-gray-800">{student.full_name}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-800">{student.email}</div>
                        <div className="text-sm text-gray-500">{student.phone || 'N/A'}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-800">{student.date_of_birth}</div>
                        <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800">
                          {student.category}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-3 py-1 inline-flex text-xs leading-5 font-bold rounded-full ${
                          student.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}>
                          {student.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button 
                          onClick={() => toggleStudentStatus(student.id, student.status)}
                          className={`text-xs font-bold mr-4 ${student.status === 'active' ? 'text-orange-600 hover:text-orange-900' : 'text-green-600 hover:text-green-900'}`}
                        >
                          {student.status === 'active' ? 'Disable Login' : 'Enable Login'}
                        </button>
                        <button 
                          onClick={() => deleteStudent(student.id, student.full_name)}
                          className="text-red-600 hover:text-red-900 text-xs font-bold"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ADD STUDENT MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-[#005fa7] text-white px-6 py-4 flex justify-between items-center">
              <h2 className="font-bold text-lg">Register New Candidate</h2>
              <button onClick={() => {setShowAddModal(false); resetForm();}} className="text-white hover:text-gray-200 text-xl font-bold">&times;</button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1">
              <form id="add-student-form" onSubmit={handleAddStudent} className="space-y-5">
                
                {/* Photo Upload Section */}
                <div className="border border-gray-300 p-4 rounded bg-gray-50 flex gap-6 items-center">
                  <div className="flex-1">
                    <label className="block text-sm font-bold text-gray-700 mb-2">Candidate Photo (Optional)</label>
                    <input 
                      type="file" 
                      accept="image/*"
                      ref={fileInputRef}
                      onChange={handleImageChange}
                      className="text-sm w-full text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-bold file:bg-blue-50 file:text-[#005fa7] hover:file:bg-blue-100"
                    />
                  </div>
                  {imagePreview && (
                     <div className="h-24 w-24 rounded border-2 border-[#005fa7] overflow-hidden shadow">
                       <img src={imagePreview} alt="Preview" className="h-full w-full object-cover" />
                     </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">Full Name *</label>
                    <input 
                      type="text" required
                      value={formData.full_name} onChange={e => setFormData({...formData, full_name: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:border-[#005fa7] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">Email Address *</label>
                    <input 
                      type="email" required
                      value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:border-[#005fa7] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">Date of Birth (Password) *</label>
                    <input 
                      type="date" required
                      value={formData.date_of_birth} onChange={e => setFormData({...formData, date_of_birth: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:border-[#005fa7] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">Phone Number</label>
                    <input 
                      type="tel" 
                      value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:border-[#005fa7] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">Category</label>
                    <select 
                      value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:border-[#005fa7] outline-none bg-white"
                    >
                      <option value="General">General</option>
                      <option value="OBC-NCL">OBC-NCL</option>
                      <option value="SC">SC</option>
                      <option value="ST">ST</option>
                      <option value="Gen-EWS">Gen-EWS</option>
                    </select>
                  </div>
                </div>
              </form>
            </div>
            
            <div className="bg-gray-100 px-6 py-4 border-t border-gray-300 flex justify-end gap-3">
              <button 
                onClick={() => {setShowAddModal(false); resetForm();}}
                className="px-6 py-2 bg-white border border-gray-400 text-gray-700 rounded font-bold hover:bg-gray-50"
              >
                Cancel
              </button>
              <button 
                form="add-student-form" type="submit" disabled={saving}
                className="px-6 py-2 bg-[#28a745] text-white rounded font-bold hover:bg-[#218838] shadow disabled:opacity-50"
              >
                {saving ? 'Registering...' : 'Register Candidate'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default ManageStudents;
