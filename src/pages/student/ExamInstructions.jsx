import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

const ExamInstructions = () => {
  const { examId } = useParams();
  const navigate = useNavigate();
  
  const [student, setStudent] = useState(null);
  const [exam, setExam] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isChecked, setIsChecked] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const userId = sessionStorage.getItem('userId');
        const role = sessionStorage.getItem('role');

        const cameraGranted = sessionStorage.getItem("cameraGranted") === "true";
        if (!cameraGranted) {
          navigate("/student/exams");
          return;
        }

        if (!userId || role !== 'student') {
          navigate('/');
          return;
        }

        const [studentRes, examRes] = await Promise.all([
          supabase.from('students').select('*').eq('id', userId).single(),
          supabase.from('exams').select('*').eq('id', examId).single()
        ]);

        if (studentRes.error) throw studentRes.error;
        if (examRes.error) throw examRes.error;

        setStudent(studentRes.data);
        setExam(examRes.data);
      } catch (err) {
        console.error('Error fetching instructions data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [examId, navigate]);

  const handleProceed = () => {
    if (isChecked) {
      // Navigate directly to the exam interface.
      // ExamInterface handles fullscreen enforcement itself — attempting it here
      // caused a double-request race condition that resulted in a white screen.
      navigate(`/student/exam/${examId}/start`);
    }
  };


  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f1f4f9]">
        <div className="text-[#1f497d] font-semibold text-xl flex items-center">
           <svg className="animate-spin h-6 w-6 mr-3" viewBox="0 0 24 24">
             <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
             <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
           </svg>
           Loading Instructions...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white font-sans text-gray-800 flex flex-col select-none">
      {/* Top Banner */}
      <div className="bg-[#1f497d] text-white px-6 py-2 flex justify-between items-center border-b-4 border-yellow-500 shadow-sm">
        <div className="font-bold text-lg tracking-wide uppercase">
          {exam?.title || 'GENERAL INSTRUCTIONS'}
        </div>
      </div>

      <div className="flex flex-col md:flex-row flex-grow overflow-hidden">
        
        {/* Left/Main Content - Instructions */}
        <div className="w-full md:w-3/4 flex flex-col h-[calc(100vh-100px)]">
          <div className="flex justify-between items-center px-8 py-3 border-b border-gray-300 bg-gray-50">
            <h2 className="text-xl font-bold text-[#1f497d]">Please read the instructions carefully</h2>
            <div className="flex items-center space-x-2">
              <span className="text-sm font-semibold">View In:</span>
              <select className="border border-gray-400 rounded px-2 py-1 text-sm bg-white focus:outline-none focus:border-[#1f497d]">
                <option value="english">English</option>
              </select>
            </div>
          </div>

          {/* Scrollable Instructions Area */}
          <div className="p-8 overflow-y-auto text-sm leading-relaxed space-y-6">
            
            <section>
              <h3 className="font-bold text-base underline mb-2">General Instructions:</h3>
              <ol className="list-decimal pl-5 space-y-2">
                <li>Total duration of examination is <strong>{exam?.duration_minutes || 180} minutes</strong>.</li>
                <li>The clock will be set at the server. The countdown timer in the top right corner of screen will display the remaining time available for you to complete the examination. When the timer reaches zero, the examination will end by itself. You will not be required to end or submit your examination.</li>
                <li>The Question Palette displayed on the right side of screen will show the status of each question using one of the following symbols:
                  
                  <div className="mt-4 space-y-3 bg-gray-50 p-4 border border-gray-200 rounded">
                    <div className="flex items-center">
                      <div className="w-8 h-8 flex items-center justify-center bg-gray-200 border border-gray-400 rounded mr-3 font-bold text-gray-600">1</div>
                      <span>You have not visited the question yet.</span>
                    </div>
                    <div className="flex items-center">
                      <div className="w-8 h-8 flex items-center justify-center bg-red-500 border border-red-600 text-white rounded-t-md rounded-bl-md mr-3 font-bold">2</div>
                      <span>You have not answered the question.</span>
                    </div>
                    <div className="flex items-center">
                      <div className="w-8 h-8 flex items-center justify-center bg-green-500 border border-green-600 text-white rounded-t-md rounded-br-md mr-3 font-bold">3</div>
                      <span>You have answered the question.</span>
                    </div>
                    <div className="flex items-center">
                      <div className="w-8 h-8 flex items-center justify-center bg-purple-600 border border-purple-700 text-white rounded-full mr-3 font-bold">4</div>
                      <span>You have NOT answered the question, but have marked the question for review.</span>
                    </div>
                    <div className="flex items-center">
                      <div className="w-8 h-8 flex items-center justify-center bg-purple-600 border border-purple-700 text-white rounded-full mr-3 font-bold relative">
                        5
                        <div className="absolute bottom-1 right-1 w-2.5 h-2.5 bg-green-400 rounded-full border border-white"></div>
                      </div>
                      <span>The question(s) "Answered and Marked for Review" will be considered for evaluation.</span>
                    </div>
                  </div>
                </li>
                <li>You can click on the "&gt;" arrow which appears to the left of question palette to collapse the question palette thereby maximizing the question window. To view the question palette again, you can click on "&lt;" which appears on the right side of question window.</li>
              </ol>
            </section>

            <section>
              <h3 className="font-bold text-base underline mb-2">Navigating to a Question:</h3>
              <ol className="list-decimal pl-5 space-y-2">
                <li>To answer a question, do the following:
                  <ul className="list-[lower-alpha] pl-6 mt-1 space-y-1">
                    <li>Click on the question number in the Question Palette at the right of your screen to go to that numbered question directly. Note that using this option does NOT save your answer to the current question.</li>
                    <li>Click on <strong>Save & Next</strong> to save your answer for the current question and then go to the next question.</li>
                    <li>Click on <strong>Mark for Review & Next</strong> to save your answer for the current question, mark it for review, and then go to the next question.</li>
                  </ul>
                </li>
              </ol>
            </section>

            <section>
              <h3 className="font-bold text-base underline mb-2">Answering a Question:</h3>
              <ol className="list-decimal pl-5 space-y-2">
                <li>Procedure for answering a multiple choice type question:
                  <ul className="list-[lower-alpha] pl-6 mt-1 space-y-1">
                    <li>To select your answer, click on the button of one of the options.</li>
                    <li>To deselect your chosen answer, click on the button of the chosen option again or click on the <strong>Clear Response</strong> button.</li>
                    <li>To change your chosen answer, click on the button of another option.</li>
                    <li>To save your answer, you MUST click on the <strong>Save & Next</strong> button.</li>
                    <li>To mark the question for review, click on the <strong>Mark for Review & Next</strong> button.</li>
                  </ul>
                </li>
                <li>Procedure for answering a numerical value type question:
                  <ul className="list-[lower-alpha] pl-6 mt-1 space-y-1">
                    <li>To enter a number as your answer, use the virtual numeric keypad or your physical keyboard.</li>
                    <li>To clear your answer, click on the <strong>Clear Response</strong> button.</li>
                    <li>To save your answer, you MUST click on the <strong>Save & Next</strong> button.</li>
                  </ul>
                </li>
              </ol>
            </section>

          </div>
        </div>

        {/* Right Column - Candidate Profile */}
        <div className="w-full md:w-1/4 bg-gray-100 border-l border-gray-300 p-6 flex flex-col items-center shadow-inner">
          <div className="w-32 h-40 bg-white border border-gray-400 shadow-sm mb-4 flex items-center justify-center overflow-hidden p-1">
            {student?.photo_url ? (
              <img src={student.photo_url} alt="Candidate" className="w-full h-full object-cover" />
            ) : (
              <svg className="h-20 w-20 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M24 20.993V24H0v-2.996A14.977 14.977 0 0112.004 15c4.904 0 9.26 2.354 11.996 5.993zM16.002 8.999a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            )}
          </div>
          <div className="w-full text-center space-y-2">
            <p className="text-lg font-bold text-[#1f497d] break-words">{student?.full_name || 'STUDENT NAME'}</p>
            <p className="text-sm font-semibold text-gray-600">{student?.application_id || 'APP NUMBER'}</p>
          </div>
        </div>
      </div>

      {/* Footer / Declaration Area */}
      <div className="border-t-2 border-gray-300 bg-gray-50 px-8 py-4 sticky bottom-0 z-10 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
        <label className="flex items-start space-x-3 cursor-pointer group">
          <input 
            type="checkbox" 
            className="mt-1 w-5 h-5 text-[#1f497d] border-gray-400 rounded focus:ring-[#1f497d] cursor-pointer"
            checked={isChecked}
            onChange={(e) => setIsChecked(e.target.checked)}
          />
          <span className="text-sm text-gray-700 leading-snug group-hover:text-black transition-colors font-medium">
            I have read and understood the instructions. All computer hardware allotted to me are in proper working condition. I declare that I am not in possession of / not wearing / not carrying any prohibited gadget like mobile phone, bluetooth devices etc. / any prohibited material with me into the Examination Hall. I agree that in case of not adhering to the instructions, I shall be liable to be debarred from this Test and/or to disciplinary action, which may include ban from future Tests / Examinations.
          </span>
        </label>
        
        <div className="mt-4 flex justify-center">
          <button
            onClick={handleProceed}
            disabled={!isChecked}
            className={`px-12 py-2.5 font-bold text-lg uppercase transition-all shadow-md ${
              isChecked 
                ? 'bg-[#1f497d] text-white hover:bg-[#15345a] cursor-pointer transform hover:scale-105' 
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            Proceed
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExamInstructions;
