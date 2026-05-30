import { useState } from 'react'
import { toast } from 'sonner'
import { Upload, FileText, Sparkles, Download, Loader2, Brain } from 'lucide-react'

export default function AIContentAggregator() {
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState(null)

  const handleFileUpload = (e) => {
    const selectedFiles = Array.from(e.target.files)
    setFiles([...files, ...selectedFiles])
  }

  const removeFile = (index) => {
    setFiles(files.filter((_, i) => i !== index))
  }

  const handleProcess = async () => {
    if (files.length === 0) {
      toast.error('Please upload at least one file')
      return
    }

    setProcessing(true)
    
    // Simulate AI processing
    setTimeout(() => {
      setProcessing(false)
      setResult({
        summary: `Processed ${files.length} file(s) successfully.`,
        questions: 45,
        chapters: 6,
        subjects: ['Physics', 'Chemistry', 'Mathematics']
      })
      toast.success('AI processing complete!')
    }, 3000)
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
          <Brain className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">AI Content Aggregator</h1>
          <p className="text-sm text-muted-foreground">Upload coaching materials → AI extracts & formats → Download branded PDFs</p>
        </div>
      </div>

      {/* Upload Area */}
      <div className="glass-card rounded-xl p-8 text-center border-2 border-dashed border-primary/30">
        <Upload className="w-12 h-12 text-primary/50 mx-auto mb-4" />
        <p className="text-lg font-semibold mb-2">Drag & Drop Files Here</p>
        <p className="text-sm text-muted-foreground mb-4">
          Supports PDF, Word, PowerPoint, Images (JPG, PNG)
        </p>
        <label className="cursor-pointer">
          <span className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90">
            Browse Files
          </span>
          <input type="file" multiple accept=".pdf,.doc,.docx,.ppt,.pptx,.jpg,.jpeg,.png" onChange={handleFileUpload} className="hidden" />
        </label>
      </div>

      {/* File List */}
      {files.length > 0 && (
        <div className="glass-card rounded-xl p-4">
          <h3 className="font-semibold mb-3">{files.length} file(s) selected</h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {files.map((file, i) => (
              <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-secondary/20">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm">{file.name}</span>
                </div>
                <button onClick={() => removeFile(i)} className="text-red-400 hover:text-red-500">✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Process Button */}
      {files.length > 0 && (
        <button
          onClick={handleProcess}
          disabled={processing}
          className="w-full py-3 rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {processing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
          {processing ? 'AI Processing...' : 'Generate with AI'}
        </button>
      )}

      {/* Results */}
      {result && (
        <div className="glass-card rounded-xl p-6 border border-green-500/30">
          <h3 className="font-semibold text-green-400 mb-3">AI Processing Complete!</h3>
          <p className="text-sm mb-4">{result.summary}</p>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="text-center p-3 rounded-lg bg-secondary/20">
              <p className="text-2xl font-bold text-primary">{result.questions}</p>
              <p className="text-xs text-muted-foreground">Questions</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-secondary/20">
              <p className="text-2xl font-bold text-accent">{result.chapters}</p>
              <p className="text-xs text-muted-foreground">Chapters</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-secondary/20">
              <p className="text-2xl font-bold text-green-400">{result.subjects.length}</p>
              <p className="text-xs text-muted-foreground">Subjects</p>
            </div>
          </div>
          <button className="w-full py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 flex items-center justify-center gap-2">
            <Download className="w-4 h-4" /> Download A4 PDF
          </button>
        </div>
      )}
    </div>
  )
}
