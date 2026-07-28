import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { GoogleReCaptchaProvider } from 'react-google-recaptcha-v3'
import './axiosSetup';
import './css/Global.css'
import './css/Footer.css'
import './css/Home.css'
import './css/NavBar.css'
import App from './App.jsx'
import HashScrollHandler from './components/HashScrollHandler.jsx'

const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;

const isKeyValid = siteKey && siteKey !== "undefined" && siteKey.length > 10;

const root = createRoot(document.getElementById('root'));

root.render(
  <BrowserRouter>
    <HashScrollHandler />
    {isKeyValid ? (
      <GoogleReCaptchaProvider 
        reCaptchaKey={siteKey}
        useRecaptchaNet={false} 
        scriptProps={{
          async: true,
          defer: true,
          appendTo: 'head',
        }}
      >
        <App />
      </GoogleReCaptchaProvider>
    ) : (
      <App />
    )}
  </BrowserRouter>
);
