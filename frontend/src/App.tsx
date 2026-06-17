import {
  BrowserRouter,
  Routes,
  Route,
  useLocation
} from "react-router-dom"

import type { ReactNode } from "react"
import { AnimatePresence, motion } from "framer-motion"

import Home from "./pages/Home"
import AccessFile from "./pages/AccessFile"

function Page({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ x: 90, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: -90, opacity: 0 }}
      transition={{ duration: 0.35, ease: "easeInOut" }}
    >
      {children}
    </motion.div>
  )
}

function AnimatedRoutes() {
  const location = useLocation()

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<Page><Home /></Page>} />
        <Route path="/access" element={<Page><AccessFile /></Page>} />
        <Route path="/access/:id" element={<Page><AccessFile /></Page>} />
      </Routes>
    </AnimatePresence>
  )
}

function App() {

  return (

    <BrowserRouter>
      <AnimatedRoutes />

    </BrowserRouter>

  )

}

export default App
