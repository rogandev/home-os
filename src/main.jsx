import SessionGate from './SessionGate.jsx'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
createRoot(document.getElementById('root')).render(<StrictMode><SessionGate><App /></SessionGate></StrictMode>)
