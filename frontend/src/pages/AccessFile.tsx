import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import ColorBends from "@/components/ColorBends"
import { useMemo, useState } from "react"
import api from "../services/api"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Card, CardContent, CardDescription,
  CardFooter, CardHeader, CardTitle
} from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Separator } from "@/components/ui/separator"
import { motion } from "framer-motion"

// Server tur metadata structure
type E2EEMetadataV1 = {
  v: 1
  kdf: "PBKDF2"
  hash: "SHA-256"
  iterations: number
  saltB64u: string
  cipher: "AES-256-GCM"
  ivB64u: string
  aadB64u: string
}

// File metadata response serveror /metadata endpointor
type MetadataResponse = {
  success: boolean
  fileTitle: string
  originalName: string
  mimeType: string
  originalSize: number
  e2ee: E2EEMetadataV1
  encryptedDownloadURL: string
}

type SearchByTitleResponse = MetadataResponse & {
  fileId: string
}

const AccessFile = () => {
  const { id } = useParams()           // URL tur file ID (eg- /access/:id)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  // URL tur ?title= 'param'or pora fileor naam ane
  const titleFromLink = useMemo(() => searchParams.get("title")?.trim() || "", [searchParams])

  // Component state
  const [password, setPassword] = useState("")
  const [fileMeta, setFileMeta] = useState<MetadataResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)
  const [accessValue, setAccessValue] = useState("") // ID-less page-t input
  const [downloaded, setDownloaded] = useState(false)

  // Display title server metadata
  const displayTitle = useMemo(
    () => (fileMeta?.fileTitle || titleFromLink || "").trim(),
    [fileMeta, titleFromLink]
  )

  // Base64 URL safe string tuk Uint8Array loi convert kore
  const base64UrlToBytes = (b64u: string) => {
    const b64 = b64u.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64u.length + 3) % 4)
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes
  }

  // Password aru metadata use kori AES-GCM decrypt key derive kore
  const deriveAesGcmKey = async (params: {
    password: string; salt: Uint8Array; iterations: number
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
      ["decrypt"]
    )
  }

  // Encrypted bytes tuk password diye decrypt kori 'Blob' return kore
  const decryptToBlob = async (params: {
    encryptedBytes: ArrayBuffer; password: string; meta: MetadataResponse
  }) => {
    const salt = base64UrlToBytes(params.meta.e2ee.saltB64u)
    const iv = base64UrlToBytes(params.meta.e2ee.ivB64u)
    const aad = base64UrlToBytes(params.meta.e2ee.aadB64u)

    const key = await deriveAesGcmKey({ password: params.password, salt, iterations: params.meta.e2ee.iterations })

    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: aad }, key, params.encryptedBytes
    )

    return new Blob([plaintext], { type: params.meta.mimeType || "application/octet-stream" })
  }

  // Blob tuk browser download trigger kore
  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  // Server tur pora file metadata fetch kore
  const fetchMetadata = async (fileId: string) => {
    const response = await api.get<MetadataResponse>(`/metadata/${fileId}`)
    setFileMeta(response.data)
    return response.data
  }

  // Metadata fetch → encrypted file download → decrypt → browser tut save kore
  const decryptAndDownload = async () => {
    if (!id) { setError("Please open a valid access link first."); return }
    if (!password) { setError("Please enter the password."); return }

    try {
      setLoading(true)
      setError("")
      setDownloaded(false)

      // Metadata fetch kore
      const meta = fileMeta || (await fetchMetadata(id))

      // Encrypted file bytes fetch kore
      const encryptedResponse = await api.get<ArrayBuffer>(`/encrypted/${id}`, {
        responseType: "arraybuffer"
      })

      const blob = await decryptToBlob({ encryptedBytes: encryptedResponse.data, password, meta })
      triggerDownload(blob, meta.originalName)
      setDownloaded(true)
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { message?: string } } }
      setError(ax.response?.data?.message || "Incorrect password or corrupted file.")
    } finally {
      setLoading(false)
    }
  }

  // Access input 'link / ID / title' parse kori correct URLt navigate kore
  const goToAccess = async () => {
    const raw = accessValue.trim()
    if (!raw) { setError("Enter a file link or ID."); return }
    setError("")

    const navigate_ = (nextId: string, nextTitle: string) => {
      const search = nextTitle.trim() ? `?title=${encodeURIComponent(nextTitle.trim())}` : ""
      navigate(`/access/${encodeURIComponent(nextId)}${search}`)
    }

    const uuidV4Like =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

    // "/access/:id" path match koribo
    const directMatch = raw.match(/\/access\/([^/?\s]+)(?:\?([^#\s]+))?/)
    if (directMatch?.[1]) {
      const titleMatch = (directMatch[2] || "").match(/(?:^|&)title=([^&]+)/)
      navigate_(directMatch[1], titleMatch?.[1] ? decodeURIComponent(titleMatch[1]) : "")
      return
    }

    // Full URL tu parse koribo
    try {
      const url = new URL(raw)
      const match = url.pathname.match(/\/access\/([^/]+)/)
      if (match?.[1]) { navigate_(match[1], url.searchParams.get("title") || ""); return }
    } catch { /* URL nohole plain ID hisape treat kore */ }

    if (uuidV4Like.test(raw)) {
      navigate_(raw, "")
      return
    }

    try {
      const response = await api.post<SearchByTitleResponse>(
        "/search-file",
        { title: raw }
      )
      navigate_(response.data.fileId, response.data.fileTitle)
    } catch (err: unknown) {
      const ax = err as { response?: { status?: number; data?: { message?: string } } }
      if (ax.response?.status === 404) {
        setError("File not found. Please paste the access link/ID, or use the exact title used during upload.")
        return
      }
      navigate_(raw, "")
    }
  }

  // Clipboard copy with execCommand fallback
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

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="ts-layout ts-layout--narrow ts-layout-wrapper ts-space-y-8"
      >
        <div className="ts-hero">
          <h1 className="ts-hero-title ts-hero-title--access">
            Temporary File <span className="ts-title-highlight">Accessing</span>
          </h1>
          <p className="ts-hero-subtitle">
            Enter the password to open the shared file safely.
          </p>

          <div className="ts-top-actions">
            <Button onClick={() => navigate("/")} variant="secondary" className="ts-btn-secondary ts-btn-pill">
              Upload
            </Button>
            <Button onClick={() => navigate("/access")} variant="default" className="ts-btn-primary ts-btn-pill">
              Access
            </Button>
          </div>
        </div>

        <Card className="ts-card">
          <CardHeader className="ts-card-header">
            <div className="ts-space-y-5">
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
                  <CardTitle className="ts-card-title">Secure Access</CardTitle>
                  <CardDescription className="ts-card-description">
                    Enter the password to access the file.
                  </CardDescription>
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent className="ts-card-content ts-space-y-5">
            {!id ? (
              <>
                <div className="ts-panel ts-text-sm ts-text-slate-500">
                  Paste a link, enter a file ID, or type the exact file title you used during upload.
                </div>
                <div className="ts-space-y-2">
                  <Label htmlFor="access-id" className="ts-label">Access link / ID / title</Label>
                  <Input
                    id="access-id"
                    placeholder="Paste link, enter ID, or enter title"
                    value={accessValue}
                    onChange={(e) => setAccessValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void goToAccess() }}
                    className="ts-input"
                  />
                </div>
                {error && (
                  <Alert variant="destructive" className="ts-alert">
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
              </>
            ) : (
              <>
                {displayTitle && (
                  <div className="ts-panel">
                    <div className="ts-panel-eyebrow">File</div>
                    <div className="ts-mt-2 ts-break-words ts-panel-title">{displayTitle}</div>
                  </div>
                )}

                {fileMeta && (
                  <div className="ts-meta-box">
                    {fileMeta.originalName} • {Math.round(fileMeta.originalSize / 1024)} KB
                  </div>
                )}

                <div className="ts-space-y-2">
                  <Label htmlFor="password" className="ts-label">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Enter password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") decryptAndDownload() }}
                    className="ts-input"
                  />
                </div>

                {error && (
                  <Alert variant="destructive" className="ts-alert">
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <Button
                  onClick={decryptAndDownload}
                  disabled={loading}
                  className="ts-btn-primary ts-w-full"
                >
                  {loading ? "Decrypting..." : "Decrypt & Download"}
                </Button>

                {downloaded && fileMeta && (
                  <>
                    <Separator className="ts-separator" />
                    <div className="ts-panel">
                      <div className="ts-space-y-3">
                        <div className="ts-panel-title">Download started</div>
                        <div className="ts-break-words ts-panel-text">
                          {fileMeta.originalName}
                        </div>
                        <Button
                          variant="secondary"
                          onClick={() => copyText(window.location.href)}
                          className="ts-btn-secondary ts-w-full"
                        >
                          {copied ? "Copied" : "Copy access link"}
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </CardContent>

          <CardFooter className="ts-footer">
            {!id ? (
              <Button
                className="ts-btn-primary ts-w-full"
                onClick={() => void goToAccess()}
              >
                Continue
              </Button>
            ) : (
              <div className="ts-footer-note">
                Make sure you trust the sender before entering passwords.
              </div>
            )}
          </CardFooter>
        </Card>
      </motion.div>
    </div>
  )
}

export default AccessFile
