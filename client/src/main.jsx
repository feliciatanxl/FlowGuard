import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './css/Global.css'
import './css/Footer.css'
import './css/Home.css'
import './css/NavBar.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
