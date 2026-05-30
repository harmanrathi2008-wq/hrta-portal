import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

const ExamCountdown = ({ startDatetime, onComplete }) => {
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    const target = new Date(startDatetime).getTime();

    const updateTimer = () => {
      const now = Date.now();
      const diff = target - now;

      if (diff <= 0) {
        setTimeLeft('Active');
        if (onComplete) onComplete();
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const secs = Math.floor((diff % (1000 * 60)) / 1000);

      setTimeLeft(`${days}d ${hours}h ${mins}m ${secs}s`);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [startDatetime, onComplete]);

  return <span className="font-mono text-amber-600 font-bold">{timeLeft}</span>;
};

const StudentExams = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  
  const [activeExams, setActiveExams] = useState([]);
  const [upcomingExams, setUpcomingExams] = useState([]);
  const [completedExams, setCompletedExams] = useState([]);

  useEffect(() => {
    const fetchExams = async () => {
      try {
        const userId = sessionStorage.getItem('userId');
        const role = sessionStorage.getItem('role');

        if (!userId || role !== 'student') {
          navigate('/');
          return;
        }

        // Fetch all published exams
        const { data: allExams, error: examsError } = await supabase
          .from('exams')
          .select('*')
          .eq('status', 'published')
          .order('start_datetime', { ascending: true });

        if (examsError) throw examsError;

        // Fetch student's specific results
        const { data: results, error: resultsError } = await supabase
          .from('exam_results')
          .select('exam_id, status, percentage, total_score, total_marks')
          .eq('student_id', userId);

        if (resultsError) throw resultsError;

        // Fetch personal assignments
        let personalMap = new Map();
        try {
          const { data: pData } = await supabase
            .from('personal_assignments')
            .select('*')
            .eq('student_id', userId)
            .eq('status', 'active');
          if (pData) {
            personalMap = new Map(pData.map(a => [a.exam_id, a]));
          }
        } catch (err) {
          console.warn("personal_assignments table not ready:", err.message);
        }

        // Fetch late requests
        let requestsMap = new Map();
        try {
          const { data: requestsData, error: reqError } = await supabase
            .from('exam_late_requests')
            .select('*')
            .eq('student_id', userId);

          if (!reqError && requestsData) {
            requestsMap = new Map(requestsData.map(r => [r.exam_id, r]));
          }
        } catch (e) {
          console.warn("exam_late_requests table might not exist yet:", e.message);
        }

        // Group attempts
        const attemptsCountMap = new Map();
        results?.forEach(r => {
          attemptsCountMap.set(r.exam_id, (attemptsCountMap.get(r.exam_id) || 0) + 1);
        });

        const now = new Date();
        const resultsMap = new Map(results?.map(r => [r.exam_id, r]) || []);

        const active = [];
        const upcoming = [];
        const completed = [];

        allExams.forEach(exam => {
          const studentResult = resultsMap.get(exam.id);
          const startDate = exam.start_datetime ? new Date(exam.start_datetime) : null;
          const endDate = exam.end_datetime ? new Date(exam.end_datetime) : null;
          const req = requestsMap.get(exam.id);
          const hasPersonal = personalMap.has(exam.id);
          const prevAttempts = attemptsCountMap.get(exam.id) || 0;

          const examWithRequest = {
            ...exam,
            lateRequest: req ? req.status : null,
            personalAssignment: hasPersonal ? 'active' : null,
            nextAttemptNumber: prevAttempts + 1
          };

          // If student has already attempted (submitted, published, or blocked)
          if (studentResult && (studentResult.status === 'submitted' || studentResult.status === 'published' || studentResult.status === 'blocked')) {
            completed.push({ ...examWithRequest, result: studentResult });
          }

          // Distribute to active / upcoming lists
          if (hasPersonal) {
            active.push(examWithRequest);
          } else if (startDate && startDate > now) {
            upcoming.push(examWithRequest);
          } else {
            const isCompleted = studentResult && (studentResult.status === 'submitted' || studentResult.status === 'published' || studentResult.status === 'blocked');
            if (!isCompleted) {
              active.push(examWithRequest);
            }
          }
        });

        setActiveExams(active);
        setUpcomingExams(upcoming);
        setCompletedExams(completed.reverse()); // Show most recently completed first

      } catch (err) {
        console.error('Error fetching exams:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchExams();
  }, [navigate]);

  const handleRequestLateAttempt = async (examId) => {
    try {
      const userId = sessionStorage.getItem('userId');
      const { error } = await supabase
        .from('exam_late_requests')
        .insert({
          student_id: userId,
          exam_id: examId,
          status: 'pending'
        });

      if (error) throw error;
      alert("Late attempt request submitted successfully to administrator.");
      window.location.reload();
    } catch (err) {
      alert("Failed to submit request: " + err.message);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f1f4f9] flex items-center justify-center font-sans">
        <div className="text-[#1f497d] font-bold text-lg flex items-center">
          <svg className="animate-spin h-6 w-6 mr-3" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          Loading Examination Roster...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f1f4f9] font-sans pb-12">
      
      {/* NTA Exact Header Banner */}
      <div className="bg-[#1f497d] text-white py-4 px-6 shadow-md border-b-4 border-yellow-500 mb-8">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-xl font-bold uppercase tracking-wider">Test & Examination Center</h1>
            <p className="text-sm font-medium opacity-90">View and manage your examination schedule</p>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">

        {/* 1. ACTIVE EXAMINATIONS */}
        <div className="bg-white shadow-sm border border-gray-300 rounded overflow-hidden">
          <div className="bg-[#e24a4a] text-white px-5 py-3 font-bold uppercase tracking-wide flex items-center">
             <span className="relative flex h-3 w-3 mr-3">
               <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
               <span className="relative inline-flex rounded-full h-3 w-3 bg-white"></span>
             </span>
             Active Examinations (Action Required)
          </div>
          
          <div className="p-0 overflow-x-auto">
            {activeExams.length === 0 ? (
              <div className="p-8 text-center text-gray-500 font-medium border-b">
                No active examinations currently available for your batch.
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-gray-700 text-sm border-b-2 border-gray-300">
                    <th className="py-3 px-5 font-bold">Exam Title</th>
                    <th className="py-3 px-5 font-bold">Subject</th>
                    <th className="py-3 px-5 font-bold">Duration</th>
                    <th className="py-3 px-5 font-bold">Total Marks</th>
                    <th className="py-3 px-5 font-bold text-center">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {activeExams.map((exam, idx) => {
                    const now = new Date();
                    const endDate = exam.end_datetime ? new Date(exam.end_datetime) : null;
                    
                    const hasPersonal = exam.personalAssignment === 'active';
                    const isLate = endDate && endDate < now && !hasPersonal;
                    const isApproved = exam.lateRequest === 'approved';
                    const isPending = exam.lateRequest === 'pending';
                    const isRejected = exam.lateRequest === 'rejected';

                    const canStart = hasPersonal || !isLate || isApproved;

                    return (
                      <tr key={exam.id} className={`border-b border-gray-200 hover:bg-blue-50 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                        <td className="py-4 px-5 font-bold text-[#1f497d]">
                          {exam.title}
                          {hasPersonal && (
                            <span className="ml-2 bg-cyan-100 text-cyan-800 border border-cyan-300 text-[9px] px-2 py-0.5 rounded font-extrabold uppercase inline-block">
                              Personal Access Live
                            </span>
                          )}
                          {isLate && isApproved && (
                            <span className="ml-2 bg-green-100 text-green-800 border border-green-300 text-[9px] px-2 py-0.5 rounded font-extrabold uppercase inline-block">
                              Late Access Approved
                            </span>
                          )}
                          {isLate && !isApproved && !hasPersonal && (
                            <span className="ml-2 bg-red-100 text-red-800 border border-red-300 text-[9px] px-2 py-0.5 rounded font-extrabold uppercase inline-block">
                              Expired
                            </span>
                          )}
                        </td>
                        <td className="py-4 px-5 font-semibold text-gray-600">{exam.subject}</td>
                        <td className="py-4 px-5 font-semibold text-gray-600">{exam.duration_minutes} Mins</td>
                        <td className="py-4 px-5 font-semibold text-gray-600">
                          {isLate && !isApproved && !hasPersonal ? (
                            <span className="text-red-600 font-bold text-xs uppercase tracking-wider">Exam Ended</span>
                          ) : (
                            <span>{exam.correct_marks * 75}</span>
                          )}
                        </td>
                        <td className="py-4 px-5 text-center">
                          {canStart ? (
                            <Link to={`/student/exam/${exam.id}/login`}>
                              <button className="bg-[#28a745] hover:bg-[#218838] text-white px-6 py-2 rounded font-bold shadow-sm transition-colors uppercase text-xs tracking-wider">
                                {exam.nextAttemptNumber > 1 ? `Start (Attempt #${exam.nextAttemptNumber})` : 'Click Here To Start'}
                              </button>
                            </Link>
                          ) : isPending ? (
                            <button disabled className="bg-amber-100 border border-amber-300 text-amber-700 px-5 py-2 rounded font-bold text-xs tracking-wider cursor-not-allowed uppercase">
                              Request Pending...
                            </button>
                          ) : isRejected ? (
                            <span className="text-red-600 font-black text-xs uppercase tracking-wider block">Request Rejected</span>
                          ) : (
                            <button 
                              onClick={() => handleRequestLateAttempt(exam.id)}
                              className="bg-gradient-to-r from-amber-500 to-orange-600 text-slate-950 hover:from-amber-400 hover:to-orange-500 px-5 py-2 rounded font-black shadow-md text-xs tracking-wider uppercase cursor-pointer"
                            >
                              Request Late Entry
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* 2. UPCOMING EXAMINATIONS */}
        <div className="bg-white shadow-sm border border-gray-300 rounded overflow-hidden">
          <div className="bg-orange-500 text-white px-5 py-3 font-bold uppercase tracking-wide">
             Upcoming Examinations (Scheduled)
          </div>
          
          <div className="p-0 overflow-x-auto">
            {upcomingExams.length === 0 ? (
              <div className="p-8 text-center text-gray-500 font-medium border-b">
                No upcoming examinations scheduled at this time.
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-gray-700 text-sm border-b-2 border-gray-300">
                    <th className="py-3 px-5 font-bold">Exam Title</th>
                    <th className="py-3 px-5 font-bold">Subject</th>
                    <th className="py-3 px-5 font-bold">Scheduled Start</th>
                    <th className="py-3 px-5 font-bold">Scheduled End</th>
                    <th className="py-3 px-5 font-bold text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                   {upcomingExams.map((exam, idx) => (
                    <tr key={exam.id} className={`border-b border-gray-200 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                      <td className="py-4 px-5 font-bold text-gray-800">{exam.title}</td>
                      <td className="py-4 px-5 font-semibold text-gray-600">{exam.subject}</td>
                      <td className="py-4 px-5 font-semibold text-blue-600">{new Date(exam.start_datetime).toLocaleString()}</td>
                      <td className="py-4 px-5 font-semibold text-gray-600">{new Date(exam.end_datetime).toLocaleString()}</td>
                      <td className="py-4 px-5 text-center">
                        <span className="bg-orange-100 text-orange-800 border border-orange-300 px-3 py-1.5 rounded text-xs font-bold uppercase block w-fit mx-auto">
                          Starts In: <ExamCountdown startDatetime={exam.start_datetime} onComplete={() => window.location.reload()} />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* 3. COMPLETED EXAMINATIONS */}
        <div className="bg-white shadow-sm border border-gray-300 rounded overflow-hidden">
          <div className="bg-[#1f497d] text-white px-5 py-3 font-bold uppercase tracking-wide">
             Completed Examinations (History)
          </div>
          
          <div className="p-0 overflow-x-auto">
            {completedExams.length === 0 ? (
              <div className="p-8 text-center text-gray-500 font-medium border-b">
                You have not completed any examinations yet.
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-gray-700 text-sm border-b-2 border-gray-300">
                    <th className="py-3 px-5 font-bold">Exam Title</th>
                    <th className="py-3 px-5 font-bold">Subject</th>
                    <th className="py-3 px-5 font-bold">Evaluation Status</th>
                    <th className="py-3 px-5 font-bold text-center">Score Card</th>
                  </tr>
                </thead>
                <tbody>
                  {completedExams.map((exam, idx) => (
                    <tr key={exam.id} className={`border-b border-gray-200 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                      <td className="py-4 px-5 font-bold text-gray-800">{exam.title}</td>
                      <td className="py-4 px-5 font-semibold text-gray-600">{exam.subject}</td>
                      <td className="py-4 px-5">
                        {exam.result.status === 'published' ? (
                          <span className="text-green-600 font-bold flex items-center">
                            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                            Evaluated
                          </span>
                        ) : exam.result.status === 'blocked' ? (
                          <span className="text-red-600 font-bold flex items-center gap-1">
                            🚫 Access Revoked
                          </span>
                        ) : (
                          <span className="text-yellow-600 font-bold flex items-center">
                            <svg className="w-4 h-4 mr-1 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                            Pending Result
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-5 text-center">
                        {exam.result.status === 'published' ? (
                          <Link to="/student/results">
                            <button className="bg-blue-50 text-[#1f497d] border border-[#1f497d] hover:bg-[#1f497d] hover:text-white px-4 py-1.5 rounded font-bold transition-colors text-sm">
                              View Scorecard
                            </button>
                          </Link>
                        ) : (
                          <button disabled className="bg-gray-200 text-gray-500 px-4 py-1.5 rounded font-bold cursor-not-allowed text-sm border border-gray-300">
                            {exam.result.status === 'blocked' ? 'Revoked' : 'Awaiting'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

export default StudentExams;
