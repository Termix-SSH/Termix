import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { preloadAllFonts } from './utils/fontLoader.js'

preloadAllFonts();

ReactDOM.createRoot(document.getElementById('root')).render(
    <App />
)