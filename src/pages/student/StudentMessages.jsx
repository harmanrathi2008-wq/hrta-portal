import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { Send, MessageSquare, AlertCircle } from 'lucide-react'

export default function StudentMessages() {
  const [messages, setMessages] = useState([])
  const [newMessage, setNewMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [isUrgent, setIsUrgent] = useState(false)

  const studentId = sessionStorage.getItem('userId')
  const studentEmail = sessionStorage.getItem('userEmail')

  useEffect(() => {
    if (studentId) {
      loadMessages()
    } else {
      setLoading(false)
    }
  }, [studentId])

  const loadMessages = async () => {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('student_id', studentId)
      .order('created_at', { ascending: true })

    if (!error) {
      setMessages(data || [])
    }
    setLoading(false)
  }

  const sendMessage = async () => {
    if (!newMessage.trim()) {
      toast.error('Please enter a message')
      return
    }

    const { error } = await supabase
      .from('messages')
      .insert([{
        student_id: studentId,
        student_email: studentEmail,
        message: newMessage,
        is_urgent: isUrgent,
        status: 'unread',
        created_at: new Date().toISOString(),
      }])

    if (error) {
      toast.error('Failed to send message')
    } else {
      toast.success('Message sent to admin')
      setNewMessage('')
      setIsUrgent(false)
      loadMessages()
    }
  }

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading messages...</div>
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold">Messages</h1>

      {/* Messages Display */}
      <div className="glass-card rounded-xl p-4 h-[500px] overflow-y-auto space-y-3">
        {messages.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No messages yet. Send a message to admin.</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`p-3 rounded-lg ${msg.sender === 'admin' ? 'bg-primary/10 ml-8' : 'bg-secondary/30 mr-8'}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium">
                  {msg.sender === 'admin' ? 'Admin' : 'You'}
                </span>
                {msg.is_urgent && <AlertCircle className="w-3 h-3 text-red-400" />}
                <span className="text-[10px] text-muted-foreground">
                  {msg.created_at ? new Date(msg.created_at).toLocaleString() : ''}
                </span>
              </div>
              <p className="text-sm">{msg.message}</p>
              {msg.reply && (
                <div className="mt-2 p-2 rounded bg-primary/5 text-xs text-muted-foreground">
                  <span className="font-medium">Admin Reply:</span> {msg.reply}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Message Input */}
      <div className="glass-card rounded-xl p-4">
        <div className="flex gap-2">
          <textarea
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type your message here..."
            className="flex-1 px-3 py-2 rounded-lg bg-secondary/30 border border-border/50 focus:border-primary focus:outline-none resize-none"
            rows={2}
          />
          <button
            onClick={sendMessage}
            disabled={!newMessage.trim()}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <label className="flex items-center gap-2 mt-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isUrgent}
            onChange={(e) => setIsUrgent(e.target.checked)}
            className="accent-red-500"
          />
          <span className="text-xs text-muted-foreground">Mark as urgent</span>
        </label>
      </div>
    </div>
  )
}
