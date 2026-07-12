import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";

export default function ExamLogin() {
  const { examId } = useParams();
  const navigate = useNavigate();

  const [student, setStudent] = useState(null);
  const [exam, setExam] = useState(null);
  const [applicationId, setApplicationId] = useState("");
  const [password, setPassword] = useState(""); // DOB password (DD-MM-YYYY)
  const [loading, setLoading] = useState(true);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [error, setError] = useState("");
  const [systemNumber] = useState(`C${Math.floor(Math.random() * 900) + 100}`);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const userId = sessionStorage.getItem("userId");
        const role = sessionStorage.getItem("role");

        const cameraGranted = sessionStorage.getItem("cameraGranted") === "true";
        if (!cameraGranted) {
          navigate("/student/exams");
          return;
        }

        if (!userId || role !== "student") {
          navigate("/");
          return;
        }

        // Self-healing fallback: if studentSessionToken is missing, attempt to recover from Supabase session
        let token = sessionStorage.getItem("studentSessionToken") || '';
        if (!token) {
          const { data: { session } } = await supabase.auth.getSession();
          token = session?.access_token || '';
        }
        const apiBaseUrl = import.meta.env.VITE_API_URL || 'https://hrta-portal.onrender.com';
        const studentFetch = fetch(`${apiBaseUrl}/api/student/profile?studentId=${userId}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }).then(async r => {
          if (!r.ok) throw new Error("Failed to load candidate details.");
          return { data: await r.json(), error: null };
        });

        const [studentRes, examRes, resultsRes, assignmentRes] = await Promise.all([
          studentFetch,
          supabase.from("exams").select("*").eq("id", examId).single(),
          supabase.from("exam_results").select("status").eq("student_id", userId).eq("exam_id", examId).order('submitted_at', { ascending: false }).limit(5),
          supabase.from("personal_assignments").select("*").eq("student_id", userId).eq("exam_id", examId).eq("status", "active").maybeSingle()
        ]);

        if (studentRes.error) throw studentRes.error;
        if (examRes.error) throw examRes.error;

        const hasPersonal = assignmentRes.data && assignmentRes.data.status === 'active';
        const latestResult = resultsRes.data && resultsRes.data.length > 0 ? resultsRes.data[0] : null;

        // Fetch late requests status safely
        let lateRequestStatus = null;
        try {
          const { data: reqData } = await supabase
            .from("exam_late_requests")
            .select("status")
            .eq("student_id", userId)
            .eq("exam_id", examId)
            .maybeSingle();
          if (reqData) lateRequestStatus = reqData.status;
        } catch (e) {
          console.warn("exam_late_requests not configured yet.");
        }

        setStudent(studentRes.data);
        setExam(examRes.data);
        setApplicationId(studentRes.data.application_id);

        const now = new Date();
        const startDate = examRes.data.start_datetime ? new Date(examRes.data.start_datetime) : null;
        const endDate = examRes.data.end_datetime ? new Date(examRes.data.end_datetime) : null;

        if (latestResult && latestResult.status === "blocked") {
          setError("Your access to this examination has been revoked by the administrator.");
        } else if (startDate && startDate > now && !hasPersonal) {
          setError(`This examination is scheduled for the future. Starts at: ${startDate.toLocaleString()}`);
        } else if (endDate && endDate < now && lateRequestStatus !== 'approved' && !hasPersonal) {
          if (lateRequestStatus === 'pending') {
            setError("This examination window has ended. Your late attempt request is pending admin approval.");
          } else if (lateRequestStatus === 'rejected') {
            setError("Your request for late entry has been rejected by the administrator.");
          } else {
            setError("This examination window has ended. You must request a late attempt from your candidate dashboard.");
          }
        }
      } catch (err) {
        setError(err.message || "Failed to load candidate terminal details.");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [examId, navigate]);

  // Formats input automatically to DD-MM-YYYY
  const handlePasswordChange = (e) => {
    let val = e.target.value.replace(/\D/g, "");
    if (val.length > 2 && val.length <= 4) {
      val = val.slice(0, 2) + "-" + val.slice(2);
    } else if (val.length > 4) {
      val = val.slice(0, 2) + "-" + val.slice(2, 4) + "-" + val.slice(4, 8);
    }
    setPassword(val);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitLoading(true);

    try {
      // Re-verify if blocked in DB
      const { data: resData } = await supabase
        .from("exam_results")
        .select("status")
        .eq("student_id", student.id)
        .eq("exam_id", examId)
        .order('submitted_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (resData && resData.status === "blocked") {
        throw new Error("Your access to this examination has been revoked by the administrator.");
      }

      if (applicationId.trim() !== student.application_id) {
        throw new Error("Invalid Login ID / Username.");
      }

      if (password.length !== 10) {
        throw new Error("Password must be exactly in DD-MM-YYYY format.");
      }

      // Convert DD-MM-YYYY to YYYY-MM-DD for database check
      const [day, month, year] = password.split("-");
      const formattedForDb = `${year}-${month}-${day}`;

      if (formattedForDb !== student.date_of_birth) {
        throw new Error("Invalid Password. Enter your correct Date of Birth.");
      }

      navigate(`/student/exam/${examId}/instructions`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f1f4f9] text-[#1f497d] font-bold">
        <svg className="animate-spin h-8 w-8 mr-3" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        Initializing Candidate Terminal...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 font-sans select-none flex flex-col">
      
      {/* 1. TOP NAV BAR */}
      <div className="bg-[#1f497d] text-white py-1 px-6 flex justify-between items-center text-[11px] font-bold border-b border-[#143256] shrink-0">
        <span>Harman Rathi Testing Agency - Candidate Terminal</span>
        <button
          onClick={() => navigate("/student/dashboard")}
          className="bg-[#28a745] hover:bg-[#218838] px-3.5 py-1 text-white font-bold flex items-center gap-1 rounded transition-colors text-[10px] uppercase shadow-sm cursor-pointer"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path>
          </svg>
          Home
        </button>
      </div>

      {/* 2. LOGO HEADER BANNER */}
      <div className="bg-white px-6 py-2.5 flex justify-between items-center border-b border-gray-300 shadow-sm shrink-0">
        <div>
          <img src="/assets/gandhi.png" alt="Gandhi 150 Years" className="h-11 md:h-12 w-auto object-contain" />
        </div>

        <div className="flex-1 px-6 flex flex-col items-start leading-none justify-center">
          <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wider mb-0.5">राष्ट्रीय परीक्षा एजेंसी</span>
          <span className="text-[#1f497d] text-base md:text-lg font-extrabold tracking-tight">Harman Rathi Testing Agency</span>
          <span className="text-[7px] font-bold text-white bg-[#28a745] px-1.5 py-0.5 rounded tracking-widest uppercase inline-block mt-0.5">
            Excellence in Assessment
          </span>
        </div>
      </div>

      {/* 3. CANDIDATE VERIFICATION BAR */}
      <div className="bg-white border-b border-gray-300 py-3 px-6 flex flex-col md:flex-row justify-between items-center gap-4 shrink-0">
        {/* Left Box: Invigilator Warning and System ID */}
        <div className="flex items-center gap-4">
          <div className="bg-gray-100 border border-gray-300 p-2 rounded flex items-center justify-center shrink-0">
            <svg className="w-10 h-10 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
            </svg>
          </div>
          <div className="flex flex-col text-xs leading-normal">
            <div>
              <span className="font-semibold text-gray-500">System Name :</span>{" "}
              <span className="text-[#e0533c] font-black">{systemNumber}</span>
            </div>
            <p className="text-[#e0533c] font-black uppercase text-[10px] mt-0.5 tracking-wide">
              [Contact Invigilator if the Name and Photograph displayed on the screen is not yours]
            </p>
          </div>
        </div>

        {/* Right Box: Candidate Identification Panel */}
        <div className="flex items-center gap-4 border-l-0 md:border-l border-gray-300 pl-0 md:pl-6">
          <div className="grid grid-cols-1 text-right text-xs font-semibold text-gray-700 leading-normal">
            <div>
              <span className="text-gray-500">Candidate Name :</span>{" "}
              <span className="text-[#e0533c] font-bold uppercase">{student?.full_name || "STUDENT NAME"}</span>
            </div>
            <div>
              <span className="text-gray-500">Subject Name :</span>{" "}
              <span className="text-[#1f497d] font-bold">{exam?.title || "Practice Paper"}</span>
            </div>
          </div>
          
          <div className="w-12 h-14 bg-white border border-gray-400 p-0.5 rounded shadow-sm overflow-hidden flex items-center justify-center shrink-0">
            {student?.photo_url ? (
              <img src={student.photo_url} alt="Candidate" className="w-full h-full object-cover" />
            ) : (
              <svg className="w-8 h-10 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
              </svg>
            )}
          </div>
        </div>
      </div>

      {/* 4. MAIN BODY FORM CONTAINER */}
      <div className="flex-grow flex items-center justify-center p-6 bg-cover bg-center relative" style={{ backgroundImage: "radial-gradient(circle, #2b3d54, #121c27)" }}>
        
        {/* Background OMR Sheet-like Graphic Overlay */}
        <div className="absolute inset-0 opacity-5 pointer-events-none" style={{ backgroundImage: "radial-gradient(#ffffff 2px, transparent 2px)", backgroundSize: "32px 32px" }}></div>

        {/* Login Box */}
        <div className="bg-white border border-gray-300 rounded shadow-2xl w-full max-w-sm overflow-hidden z-10">
          
          {/* Header */}
          <div className="bg-gray-150 px-6 py-3 border-b border-gray-350 flex items-center">
            <h3 className="font-bold text-gray-700 text-sm tracking-wide">Login</h3>
          </div>

          {/* Form */}
          <form onSubmit={handleLogin} className="p-6 space-y-5">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 p-2.5 text-xs text-center font-bold rounded">
                {error}
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Username</label>
              <input
                type="text"
                disabled
                value={applicationId}
                className="w-full bg-gray-100 border border-gray-350 px-3 py-2 rounded text-xs font-bold text-gray-700 outline-none select-none cursor-not-allowed"
                placeholder="Candidate Login ID"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Password (DOB as DD-MM-YYYY)</label>
              <input
                type="text"
                required
                maxLength="10"
                value={password}
                onChange={handlePasswordChange}
                className="w-full border border-gray-350 px-3 py-2 rounded text-xs font-bold text-gray-800 outline-none focus:border-[#1f497d] tracking-widest shadow-inner"
                placeholder="DD-MM-YYYY"
              />
            </div>

            <button
              type="submit"
              disabled={submitLoading}
              className="w-full bg-[#337ab7] hover:bg-[#286090] text-white py-2.5 font-bold uppercase transition-colors shadow-md rounded text-xs tracking-wider cursor-pointer"
            >
              {submitLoading ? "Verifying..." : "Login"}
            </button>

            <div className="text-center">
              <span className="text-[#e0533c] text-xs font-bold animate-pulse">Click Login To proceed</span>
            </div>
          </form>
        </div>
      </div>

      {/* 5. FOOTER */}
      <div className="bg-[#1f497d] border-t border-[#143256] py-2 text-center text-white text-[10px] font-bold tracking-wide shrink-0">
        © All Rights Reserved - Harman Rathi Testing Agency
      </div>
    </div>
  );
}
