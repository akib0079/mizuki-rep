import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App.js'
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      // A 401 means the session ended; retrying just delays the redirect to sign-in.
      retry: (count, error) => {
        const status = (error as { status?: number }).status
        if (status === 401 || status === 403) return false
        return count < 2
      },
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename="/admin">
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
