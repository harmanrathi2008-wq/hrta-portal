import { Link } from 'react-router-dom'

export default function PageNotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="glass-card rounded-xl p-8 text-center max-w-md">
        <div className="text-7xl mb-4">404</div>
        <div className="h-0.5 w-16 bg-primary/30 mx-auto mb-6"></div>
        <h2 className="text-xl font-bold mb-2">Page Not Found</h2>
        <p className="text-muted-foreground mb-6">
          The page you are looking for could not be found.
        </p>
        <Link
          to="/"
          className="inline-block px-6 py-2 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90"
        >
          Go Home
        </Link>
      </div>
    </div>
  )
}
