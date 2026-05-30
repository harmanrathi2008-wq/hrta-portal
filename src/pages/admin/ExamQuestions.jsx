import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

const ExamQuestions = () => {
  const { examId } = useParams();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exam, setExam] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [editingQuestion, setEditingQuestion] = useState(null);

  // Form State
  const [questionType, setQuestionType] = useState('mcq_single');
  const [questionText, setQuestionText] = useState('');
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState('Medium');
  
  // Scoring Policies for the Flexible Engine
  const [scoringPolicy, setScoringPolicy] = useState('exact_match');
  const [positiveMarks, setPositiveMarks] = useState(4);
  const [negativeMarks, setNegativeMarks] = useState(1);
  
  // Options & Answers
  const [options, setOptions] = useState(['', '', '', '']); // For MCQs
  const [correctAnswers, setCorrectAnswers] = useState([]); // Array for multiple correct
  const [numericalAnswer, setNumericalAnswer] = useState(''); // For numerical types
  
  // Image Upload State
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const role = sessionStorage.getItem('role');
        if (role !== 'super_admin') {
          navigate('/');
          return;
        }

        const [examRes, questionsRes] = await Promise.all([
          supabase.from('exams').select('*').eq('id', examId).single(),
          supabase.from('questions').select('*').eq('exam_id', examId).order('order_index', { ascending: true })
        ]);

        if (examRes.error) throw examRes.error;
        if (questionsRes.error) throw questionsRes.error;

        setExam(examRes.data);
        setQuestions(questionsRes.data);
        setPositiveMarks(examRes.data.correct_marks || 4);
        setNegativeMarks(examRes.data.negative_marks || 1);

      } catch (err) {
        console.error("Error fetching data:", err);
        alert("Failed to load exam data.");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [examId, navigate]);

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

  const resetForm = () => {
    setQuestionText('');
    setOptions(['', '', '', '']);
    setCorrectAnswers([]);
    setNumericalAnswer('');
    setImageFile(null);
    setImagePreview('');
    setEditingQuestion(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const startEditQuestion = (q) => {
    setEditingQuestion(q);
    setQuestionType(q.question_type || 'mcq_single');
    setQuestionText(q.question_text || '');
    setTopic(q.topic || '');
    setDifficulty(q.difficulty || 'Medium');
    setScoringPolicy(q.scoring_policy || 'exact_match');
    setPositiveMarks(q.positive_marks || 4);
    setNegativeMarks(q.negative_marks || 1);
    
    // Parse correct answer
    if (q.question_type === 'mcq_single' || q.question_type === 'mcq_multiple' || q.question_type === 'true_false') {
      try {
        const parsed = JSON.parse(q.correct_answer);
        setCorrectAnswers(Array.isArray(parsed) ? parsed : [parsed]);
      } catch (e) {
        setCorrectAnswers([q.correct_answer]);
      }
      setOptions(q.options || ['', '', '', '']);
      setNumericalAnswer('');
    } else {
      setNumericalAnswer(q.correct_answer || '');
      setCorrectAnswers([]);
      setOptions(['', '', '', '']);
    }
    
    // Image preview
    setImageFile(null);
    setImagePreview(q.image_url || '');
  };

  const uploadImageToCloudinary = async (base64Image) => {
    try {
      const apiBaseUrl = import.meta.env.VITE_API_URL || 'https://hrta-production.up.railway.app';
      const response = await fetch(`${apiBaseUrl}/api/upload-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64Image })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      return data; // { secure_url, public_id }
    } catch (err) {
      console.error("Cloudinary upload failed:", err);
      throw err;
    }
  };

  const handleSaveQuestion = async (e) => {
    e.preventDefault();
    setSaving(true);

    try {
      // 1. Process Validation
      if (!questionText.trim()) throw new Error("Question text is required.");
      
      let finalOptions = null;
      let finalCorrectAnswer = null;

      if (questionType === 'mcq_single' || questionType === 'mcq_multiple') {
        const validOptions = options.filter(opt => opt.trim() !== '');
        if (validOptions.length < 2) throw new Error("At least 2 options required for MCQ.");
        if (correctAnswers.length === 0) throw new Error("Select at least one correct answer.");
        finalOptions = validOptions;
        // Store as array stringified or JSONB natively
        finalCorrectAnswer = JSON.stringify(correctAnswers); 
      } else if (questionType.includes('numerical')) {
        if (!numericalAnswer) throw new Error("Numerical answer is required.");
        finalCorrectAnswer = numericalAnswer;
      } else if (questionType === 'true_false') {
        if (correctAnswers.length === 0) throw new Error("Select True or False as correct.");
        finalOptions = ['True', 'False'];
        finalCorrectAnswer = JSON.stringify(correctAnswers);
      }

      // 2. Image upload / update logic
      let imageUrl = editingQuestion ? editingQuestion.image_url : null;
      let imagePublicId = editingQuestion ? editingQuestion.image_public_id : null;

      if (imagePreview) {
        // If imagePreview is a new file (base64 data), upload to Cloudinary
        if (imagePreview.startsWith('data:image')) {
          const uploadResult = await uploadImageToCloudinary(imagePreview);
          imageUrl = uploadResult.secure_url || uploadResult.url;
          imagePublicId = uploadResult.public_id;

          // Delete old image from Cloudinary if existed
          if (editingQuestion && editingQuestion.image_public_id) {
            try {
              const apiBaseUrl = import.meta.env.VITE_API_URL || 'https://hrta-production.up.railway.app';
              await fetch(`${apiBaseUrl}/api/delete-image`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ public_id: editingQuestion.image_public_id })
              });
            } catch (e) {
              console.error("Failed to delete old image:", e);
            }
          }
        }
      } else {
        // If imagePreview is empty, it means the user deleted the image.
        // Delete old image from Cloudinary if existed.
        if (editingQuestion && editingQuestion.image_public_id) {
          try {
            const apiBaseUrl = import.meta.env.VITE_API_URL || 'https://hrta-production.up.railway.app';
            await fetch(`${apiBaseUrl}/api/delete-image`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ public_id: editingQuestion.image_public_id })
            });
          } catch (e) {
            console.error("Failed to delete old image:", e);
          }
        }
        imageUrl = null;
        imagePublicId = null;
      }

      if (editingQuestion) {
        // Update mode
        const updatedQuestion = {
          question_type: questionType,
          question_text: questionText,
          topic: topic || exam.subject,
          difficulty,
          options: finalOptions,
          correct_answer: finalCorrectAnswer,
          positive_marks: positiveMarks,
          negative_marks: negativeMarks,
          scoring_policy: scoringPolicy,
          image_url: imageUrl,
          image_public_id: imagePublicId
        };

        const { data, error } = await supabase
          .from('questions')
          .update(updatedQuestion)
          .eq('id', editingQuestion.id)
          .select()
          .single();

        if (error) throw error;

        setQuestions(questions.map(q => q.id === editingQuestion.id ? data : q));
        resetForm();
        alert("Question Updated Successfully!");
      } else {
        // Create mode
        const newQuestion = {
          exam_id: examId,
          question_type: questionType,
          question_text: questionText,
          topic: topic || exam.subject,
          difficulty,
          options: finalOptions,
          correct_answer: finalCorrectAnswer,
          positive_marks: positiveMarks,
          negative_marks: negativeMarks,
          scoring_policy: scoringPolicy,
          image_url: imageUrl,
          image_public_id: imagePublicId,
          order_index: questions.length + 1,
          status: 'active'
        };

        const { data, error } = await supabase.from('questions').insert([newQuestion]).select().single();
        
        if (error) throw error;

        setQuestions([...questions, data]);
        resetForm();
        alert("Question Added Successfully!");
      }

    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteQuestion = async (id, imagePublicId) => {
    if (!window.confirm("Delete this question permanently?")) return;

    try {
      // 1. Delete image from Cloudinary if exists
      if (imagePublicId) {
        const apiBaseUrl = import.meta.env.VITE_API_URL || 'https://hrta-production.up.railway.app';
        await fetch(`${apiBaseUrl}/api/delete-image`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ public_id: imagePublicId })
        });
      }

      // 2. Delete from DB
      const { error } = await supabase.from('questions').delete().eq('id', id);
      if (error) throw error;

      setQuestions(questions.filter(q => q.id !== id));
    } catch (err) {
      console.error("Delete failed:", err);
      alert("Failed to delete question.");
    }
  };

  if (loading) return <div className="p-8 text-[#005fa7] font-bold">Loading Editor...</div>;

  return (
    <div className="min-h-screen bg-gray-50 font-sans p-6">
      
      {/* Header */}
      <div className="max-w-7xl mx-auto mb-6 flex justify-between items-center bg-white p-4 rounded shadow-sm border-l-4 border-[#005fa7]">
        <div>
          <Link to="/admin/dashboard" className="text-[#005fa7] hover:underline text-sm font-semibold">&larr; Back</Link>
          <h1 className="text-2xl font-bold text-gray-800 mt-1">Manage Questions: {exam?.title}</h1>
        </div>
        <div className="text-right">
          <span className="block text-sm text-gray-500 font-bold">Total Questions</span>
          <span className="text-xl font-black text-[#005fa7]">{questions.length}</span>
        </div>
      </div>

      <div className="max-w-7xl mx-auto flex flex-col lg:flex-row gap-6">
        
        {/* Left Col: Add Question Form */}
        <div className="w-full lg:w-7/12 bg-white rounded shadow-sm border border-gray-200 overflow-hidden h-fit">
          <div className="bg-[#005fa7] text-white px-6 py-3 font-bold flex justify-between items-center">
            <span>{editingQuestion ? `Edit Question (Q.${questions.indexOf(editingQuestion) + 1})` : 'Add New Question'}</span>
            {editingQuestion && (
              <button type="button" onClick={resetForm} className="bg-red-600 hover:bg-red-700 text-white px-2 py-0.5 rounded text-xs font-bold transition-colors">
                Cancel Edit
              </button>
            )}
          </div>
          
          <form onSubmit={handleSaveQuestion} className="p-6 space-y-6">
            
            {/* Type & Topic row */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Question Type</label>
                <select 
                  value={questionType} 
                  onChange={(e) => { setQuestionType(e.target.value); setCorrectAnswers([]); }}
                  className="w-full border border-gray-300 p-2 rounded focus:ring-[#005fa7] focus:border-[#005fa7]"
                >
                  <option value="mcq_single">MCQ (Single Correct)</option>
                  <option value="mcq_multiple">MCQ (Multiple Correct)</option>
                  <option value="numerical_integer">Numerical (Integer)</option>
                  <option value="numerical_decimal">Numerical (Decimal)</option>
                  <option value="true_false">True / False</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Topic / Chapter</label>
                <input 
                  type="text" 
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="e.g. Kinematics"
                  className="w-full border border-gray-300 p-2 rounded focus:ring-[#005fa7] focus:border-[#005fa7]"
                />
              </div>
            </div>

            {/* Question Text */}
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Question Text</label>
              <textarea 
                required
                rows="4"
                value={questionText}
                onChange={(e) => setQuestionText(e.target.value)}
                className="w-full border border-gray-300 p-2 rounded focus:ring-[#005fa7] focus:border-[#005fa7]"
                placeholder="Enter the question text here..."
              ></textarea>
            </div>

            {/* Image Upload */}
            <div className="border border-dashed border-gray-400 p-4 rounded bg-gray-50">
              <label className="block text-sm font-bold text-gray-700 mb-2">Upload Reference Image (Optional)</label>
              <input 
                type="file" 
                accept="image/*"
                ref={fileInputRef}
                onChange={handleImageChange}
                className="text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
              {imagePreview && (
                <div className="mt-3 relative inline-block">
                  <img src={imagePreview} alt="Preview" className="h-32 rounded border shadow-sm" />
                  <button type="button" onClick={() => {setImagePreview(''); setImageFile(null); fileInputRef.current.value='';}} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs shadow hover:bg-red-600">✕</button>
                </div>
              )}
            </div>

            {/* Dynamic Inputs based on Type */}
            <div className="bg-blue-50 p-4 rounded border border-blue-100">
              <h3 className="text-sm font-bold text-[#005fa7] mb-3 uppercase tracking-wide">Options & Answer Key</h3>
              
              {(questionType === 'mcq_single' || questionType === 'mcq_multiple') && (
                <div className="space-y-3">
                  {options.map((opt, i) => (
                    <div key={i} className="flex items-center space-x-3">
                      <input 
                        type={questionType === 'mcq_single' ? 'radio' : 'checkbox'}
                        name="correct_ans"
                        checked={correctAnswers.includes(opt) && opt !== ''}
                        onChange={(e) => {
                          if (!opt) return alert("Fill the option text first!");
                          if (questionType === 'mcq_single') {
                            setCorrectAnswers([opt]);
                          } else {
                            if (e.target.checked) setCorrectAnswers([...correctAnswers, opt]);
                            else setCorrectAnswers(correctAnswers.filter(a => a !== opt));
                          }
                        }}
                        className="w-5 h-5 text-[#005fa7]"
                      />
                      <input 
                        type="text"
                        value={opt}
                        onChange={(e) => {
                          const newOpts = [...options];
                          newOpts[i] = e.target.value;
                          setOptions(newOpts);
                          // Sync correct answers if option text changes
                          if (correctAnswers.includes(opt)) {
                            setCorrectAnswers(correctAnswers.filter(a => a !== opt));
                          }
                        }}
                        placeholder={`Option ${i + 1}`}
                        className="flex-1 border border-gray-300 p-2 rounded focus:ring-[#005fa7]"
                      />
                    </div>
                  ))}
                  <button type="button" onClick={() => setOptions([...options, ''])} className="text-sm text-[#005fa7] font-bold hover:underline">+ Add Option</button>
                </div>
              )}

              {questionType.includes('numerical') && (
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">Correct Numerical Value</label>
                  <input 
                    type="number"
                    step={questionType === 'numerical_decimal' ? "any" : "1"}
                    value={numericalAnswer}
                    onChange={(e) => setNumericalAnswer(e.target.value)}
                    className="w-full max-w-xs border border-gray-300 p-2 rounded focus:ring-[#005fa7]"
                    placeholder="e.g. 42"
                  />
                </div>
              )}

              {questionType === 'true_false' && (
                <div className="flex space-x-6">
                  {['True', 'False'].map(val => (
                    <label key={val} className="flex items-center space-x-2 font-bold text-gray-700">
                      <input 
                        type="radio" 
                        name="tf_ans" 
                        checked={correctAnswers.includes(val)}
                        onChange={() => setCorrectAnswers([val])}
                        className="w-5 h-5 text-[#005fa7]"
                      />
                      <span>{val}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Flexible Marking Rules Config */}
            <div className="grid grid-cols-3 gap-4 border-t pt-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase">Scoring Policy</label>
                <select value={scoringPolicy} onChange={(e) => setScoringPolicy(e.target.value)} className="w-full mt-1 border-gray-300 rounded text-sm bg-gray-50">
                  <option value="exact_match">Exact Match</option>
                  {questionType === 'mcq_multiple' && <option value="partial_positive">Partial (Positive Only)</option>}
                  {questionType === 'mcq_multiple' && <option value="partial_negative">Partial (+ Negative)</option>}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase">+ Marks</label>
                <input type="number" value={positiveMarks} onChange={(e) => setPositiveMarks(e.target.value)} className="w-full mt-1 border-gray-300 rounded text-sm bg-gray-50" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase">- Marks</label>
                <input type="number" value={negativeMarks} onChange={(e) => setNegativeMarks(e.target.value)} className="w-full mt-1 border-gray-300 rounded text-sm bg-gray-50" />
              </div>
            </div>

            <button type="submit" disabled={saving} className={`w-full text-white py-3 font-bold rounded shadow transition disabled:opacity-50 ${editingQuestion ? 'bg-[#005fa7] hover:bg-[#004b87]' : 'bg-[#28a745] hover:bg-[#218838]'}`}>
              {saving ? 'Saving & Uploading...' : editingQuestion ? 'Update Question' : 'Add Question to Exam'}
            </button>
          </form>
        </div>

        {/* Right Col: Question List List */}
        <div className="w-full lg:w-5/12 space-y-4 h-[calc(100vh-120px)] overflow-y-auto pr-2 custom-scrollbar">
          {questions.length === 0 ? (
            <div className="bg-white p-8 text-center text-gray-500 border border-gray-200 rounded">
              No questions added yet. Start by using the form.
            </div>
          ) : (
            questions.map((q, index) => (
              <div key={q.id} className={`bg-white p-4 rounded shadow-sm border relative group transition-all ${editingQuestion?.id === q.id ? 'border-[#005fa7] ring-1 ring-[#005fa7] bg-blue-50/30' : 'border-gray-200'}`}>
                
                <div className="flex justify-between items-start mb-2">
                  <span className="bg-[#005fa7] text-white text-xs font-bold px-2 py-1 rounded">Q.{index + 1}</span>
                  <div className="flex space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => startEditQuestion(q)} className="text-blue-500 hover:text-blue-700 bg-blue-50 px-2 py-1 rounded text-xs font-bold">Edit</button>
                    <button onClick={() => handleDeleteQuestion(q.id, q.image_public_id)} className="text-red-500 hover:text-red-700 bg-red-50 px-2 py-1 rounded text-xs font-bold">Delete</button>
                  </div>
                </div>

                <div className="text-sm font-bold text-gray-800 mb-2 truncate max-h-12 whitespace-normal line-clamp-2">
                  {q.question_text}
                </div>
                
                {q.image_url && (
                  <div className="mb-2">
                    <span className="text-xs text-blue-500 font-bold block mb-1">🖼️ Image Attached</span>
                    <div className="max-w-xs border rounded p-1 bg-gray-50 flex items-center justify-center">
                      <img src={q.image_url} alt="Question Graphic" className="max-h-24 object-contain" />
                    </div>
                  </div>
                )}
                
                <div className="bg-gray-50 p-2 rounded text-xs border border-gray-200 flex justify-between">
                  <span className="font-semibold text-gray-600">Key: <span className="text-green-700">{q.correct_answer}</span></span>
                  <span className="font-semibold text-gray-500">[{q.positive_marks} / -{q.negative_marks}]</span>
                </div>
              </div>
            ))
          )}
        </div>

      </div>
    </div>
  );
};

export default ExamQuestions;
