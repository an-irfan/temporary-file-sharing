import api from "../services/api"
import ColorBends from "@/components/ColorBends"
import { useMemo, useRef, useState } from "react"
import type { ChangeEvent, DragEvent } from "react"
import { useNavigate } from "react-router-dom"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Card, CardContent, CardDescription,
  CardFooter, CardHeader, CardTitle
} from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Separator } from "@/components/ui/separator"

// Serveror upload responseor structure
type UploadResponse = {
  success: boolean
  message: string
  fileTitle: string
  downloadLink: string
  qrCode: string
  expiresInMinutes: number
}

// End-to-end encryption tur metadata structure
type E2EEMetadataV1 = {
  v: 1
  kdf: "PBKDF2"
  hash: "SHA-256"
  iterations: number
  saltB64u: string
  cipher: "AES-256-GCM"
  ivB64u: string
  aadB64u: string
  originalName: string
  mimeType: string
  originalSize: number
}

// Bytes bur human readable size o loi convert kore (eg- 1024 → "1 KB")
const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

// Uint8Array tuk Base64 URL-safe string o loi convert kore
const bytesToBase64Url = (bytes: Uint8Array): string => {
  let bin = ""
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

// Cryptographically random bytes generate kore
const randomBytes = (length: number): Uint8Array => {
  const b = new Uint8Array(length)
  crypto.getRandomValues(b)
  return b
}

// Password aru salt use kori AES-GCM key derive kore (PBKDF2 use hoise)
const deriveAesGcmKey = async (params: {
  password: string
  salt: Uint8Array
  iterations: number
}) => {
  const enc = new TextEncoder()
  const baseKey = await crypto.subtle.importKey(
    "raw", enc.encode(params.password), "PBKDF2", false, ["deriveKey"]
  )
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: params.salt as BufferSource, iterations: params.iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  )
}

// Additional Authenticated Data (AAD) build kore then fileor metadata include hoise
const buildAad = (params: { v: 1; originalName: string; mimeType: string; originalSize: number }) => {
  const canonical = JSON.stringify({
    v: params.v,
    originalName: params.originalName,
    mimeType: params.mimeType,
    originalSize: params.originalSize
  })
  return new TextEncoder().encode(canonical)
}

// File tuk browserot ee encrypt kore uploador agote
const encryptFileE2EE = async (file: File, password: string) => {
  const iterations = 310_000
  const salt = randomBytes(16) // KDF tur salt
  const iv = randomBytes(12)   // AES-GCM tur IV
  const aad = buildAad({
    v: 1,
    originalName: file.name,
    mimeType: file.type || "application/octet-stream",
    originalSize: file.size
  })

  const key = await deriveAesGcmKey({ password, salt, iterations })
  const plaintext = await file.arrayBuffer()

  // AES-256-GCM diye encrypt kore
  const ciphertext = await crypto.subtle.encrypt(
  {name: "AES-GCM",
  iv: iv as BufferSource,
  additionalData: aad as BufferSource}, key, plaintext
  )

  const encryptedBlob = new Blob([ciphertext], { type: "application/octet-stream" })

  // Metadata:- serverot store hobo, then decryptot laagibo
  const metadata: E2EEMetadataV1 = {
    v: 1,
    kdf: "PBKDF2",
    hash: "SHA-256",
    iterations,
    saltB64u: bytesToBase64Url(salt),
    cipher: "AES-256-GCM",
    ivB64u: bytesToBase64Url(iv),
    aadB64u: bytesToBase64Url(aad),
    originalName: file.name,
    mimeType: file.type || "application/octet-stream",
    originalSize: file.size
  }

  return { encryptedBlob, metadata }
}

const Home = () => {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Form state
  const [title, setTitle] = useState("")
  const [password, setPassword] = useState("")
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  // Upload result aru UI state
  const [uploadData, setUploadData] = useState<UploadResponse | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  // Shareable linkot title query param tu add kore
  const shareLink = useMemo(() => {
    if (!uploadData?.downloadLink) return ""
    const effectiveTitle = uploadData.fileTitle || title
    try {
      const url = new URL(uploadData.downloadLink)
      url.searchParams.set("title", effectiveTitle)
      return url.toString()
    } catch {
      const sep = uploadData.downloadLink.includes("?") ? "&" : "?"
      return `${uploadData.downloadLink}${sep}title=${encodeURIComponent(effectiveTitle)}`
    }
  }, [uploadData, title])

  // New file set kore aru agor state clear kore
  const setFile = (file: File | null) => {
    setSelectedFile(file)
    setUploadData(null)
    setError("")
    setCopied(false)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const handleFilePick = (e: ChangeEvent<HTMLInputElement>) =>
    setFile(e.target.files?.[0] || null)

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    setFile(e.dataTransfer.files?.[0] || null)
  }

  // Clipboardot text copy kore then fallback execCommand use kore
  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement("textarea")
      ta.value = text
      Object.assign(ta.style, { position: "fixed", opacity: "0" })
      document.body.appendChild(ta)
      ta.focus(); ta.select()
      document.execCommand("copy")
      document.body.removeChild(ta)
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  // Native share sheet use kore | nohole link copy kore
  const share = async () => {
    if (!shareLink) return
    try {
      if (navigator.share) {
        await navigator.share({
          title: uploadData?.fileTitle || "TempShare",
          text: "Access the file using this link:",
          url: shareLink
        })
        return
      }
    } catch { /* share cancel hoi gole fallbackot jabo */ }
    await copyText(shareLink)
  }

  // File encrypt kori serverot upload kore
  const upload = async () => {
    if (!title.trim() || !password) {
      setError("Please enter a title and password.")
      return
    }
    if (!selectedFile) {
      setError("Please select a file to upload.")
      return
    }

    setUploading(true)
    setError("")

    try {
      const { encryptedBlob, metadata } = await encryptFileE2EE(selectedFile, password)

      // Encrypted file aru metadata FormData t rakhe
      const formData = new FormData()
      formData.append("file", new File([encryptedBlob], `${selectedFile.name}.enc`, {
        type: "application/octet-stream"
      }))
      formData.append("title", title.trim())
      formData.append("e2ee", JSON.stringify(metadata))

      const response = await api.post<UploadResponse>("/upload", formData)
      setUploadData(response.data)
    } catch (err: unknown) {
      setUploadData(null)
      const ax = err as { response?: { data?: { message?: string; error?: string } } }
      setError(ax.response?.data?.message || ax.response?.data?.error || "Upload failed.")
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="ts-page">
      <div className="absolute inset-0 z-0">
        <ColorBends 
          colors={["#e0d3ff", "#c7b8ff", "#a8c8ff"]} 
          speed={0.2}
          scale={1.2}
          intensity={0.6}
          warpStrength={0.5}
          noise={0.05}
        />
      </div>
      <div className="ts-orb ts-orb--left" />
      <div className="ts-orb ts-orb--right" />
      <div className="ts-orb ts-orb--bottom" />

      <div className="ts-layout ts-layout-wrapper ts-space-y-8">
        <div className="ts-hero">
          <h1 className="ts-hero-title">Temporary File <span className="ts-title-highlight">Sharing</span></h1>
          <p className="ts-hero-subtitle">
            Upload a file and share the access link or QR code.
          </p>

          <div className="ts-top-actions">
            <Button onClick={() => navigate("/")} variant="default" className="ts-btn-primary ts-btn-pill">
              Upload
            </Button>
            <Button onClick={() => navigate("/access")} variant="secondary" className="ts-btn-secondary ts-btn-pill">
              Access
            </Button>
            <div className="ts-pill">
              Expiry: {uploadData?.expiresInMinutes ?? 5} min
            </div>
          </div>
        </div>

        <Card className="ts-card">
          <CardHeader className="ts-card-header">
            <div className="ts-card-heading">
              <div className="ts-card-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" fill="white" opacity="0.8"/>
                  <path d="M14 2V8H20" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M8 13H16" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M8 17H12" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div className="ts-space-y-1">
                <CardTitle className="ts-card-title">Upload a file</CardTitle>
                <CardDescription className="ts-card-description">
                  Set a title and password, then choose a file.
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="ts-card-content ts-space-y-6">
            <div className="ts-grid-2">
              <div className="ts-space-y-2">
                <Label htmlFor="title" className="ts-label">File title</Label>
                <Input
                  id="title"
                  placeholder="e.g. Project ZIP"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="ts-input"
                />
              </div>
              <div className="ts-space-y-2">
                <Label htmlFor="pw" className="ts-label">Access password</Label>
                <Input
                  id="pw"
                  type="password"
                  placeholder="Set a password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="ts-input"
                />
              </div>
            </div>

            {error && (
              <Alert variant="destructive" className="ts-alert">
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div
              onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              className={`ts-dropzone ts-dropzone-extra ${dragOver ? "ts-dropzone--active" : ""}`}
            >
              <div className="ts-dropzone-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" fill="white" opacity="0.8"/>
                  <path d="M14 2V8H20" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M8 13H16" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M8 17H12" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
              <div className="ts-dropzone-title">
                {selectedFile ? "File selected" : "Drag and drop your file here"}
              </div>
              <div className="ts-dropzone-text">
                {selectedFile
                  ? `${selectedFile.name} • ${formatBytes(selectedFile.size)}`
                  : "or click to browse"}
              </div>
              {!selectedFile && (
                <div className="ts-dropzone-meta">
                  Any file type supported
                </div>
              )}
              <input type="file" ref={fileInputRef} hidden onChange={handleFilePick} />
            </div>

            <div className="ts-flex-row">
              <Button
                onClick={upload}
                disabled={uploading}
                className="ts-btn-primary ts-w-full ts-w-auto-sm"
              >
                {uploading ? "Uploading..." : "Upload"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setFile(null)}
                disabled={uploading}
                className="ts-btn-secondary ts-w-full ts-w-auto-sm"
              >
                Clear
              </Button>
            </div>

            {uploadData && (
              <>
                <Separator className="ts-separator" />
                <div className="ts-grid-3">
                  <div className="ts-space-y-4 ts-col-span-2">
                    <div className="ts-space-y-1">
                      <div className="ts-panel-title">
                        Uploaded: {uploadData.fileTitle}
                      </div>
                      <div className="ts-panel-text">
                        Share this link or let someone scan the QR code. They&apos;ll be asked for the password.
                      </div>
                    </div>
                    <div className="ts-panel">
                      <div className="ts-space-y-3">
                        <div className="ts-panel-eyebrow">
                          Shareable link
                        </div>
                        <div className="ts-flex-col-span-2">
                          <Input
                            value={shareLink}
                            readOnly
                            className="ts-input ts-flex-1"
                          />
                          <Button
                            variant="secondary"
                            onClick={() => copyText(shareLink)}
                            className="ts-btn-secondary"
                          >
                            {copied ? "Copied" : "Copy"}
                          </Button>
                        </div>
                        <div className="ts-flex-col-span-2">
                          <a href={shareLink} target="_blank" className="ts-w-full ts-w-auto-sm">
                            <Button
                              variant="outline"
                              className="ts-btn-secondary ts-w-full"
                            >
                              Open access page
                            </Button>
                          </a>
                          <Button
                            className="ts-btn-primary ts-w-full ts-w-auto-sm"
                            onClick={share}
                          >
                            Share
                          </Button>
                        </div>
                        <div className="ts-footer-note">
                          Expires in {uploadData.expiresInMinutes} minutes
                        </div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="ts-mb-2 ts-text-center ts-text-sm ts-font-medium ts-text-slate-500">QR code</div>
                    <Card className="ts-qr-card">
                      <img src={uploadData.qrCode} alt="QR Code" className="ts-w-full ts-rounded-2xl ts-bg-white ts-p-2" />
                    </Card>
                  </div>
                </div>
              </>
            )}
          </CardContent>

          <CardFooter className="ts-footer ts-flex-row">
            <div className="ts-footer-note">
              Your file is end-to-end encrypted in the browser before upload.
            </div>
            <Button
              variant="secondary"
              onClick={() => navigate("/access")}
              className="ts-btn-secondary"
            >
              Access
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}

export default Home
