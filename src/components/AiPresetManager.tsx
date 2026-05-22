import { useState, useCallback, useEffect } from "react"
import type { AIProvider, AIProviderConfig } from "@shared/game"
import { cn } from "@/lib/utils"
import { Loader2, Plus, Trash2, Wifi, WifiOff, Pencil, Check, X } from "lucide-react"

const STORAGE_KEY = "noir-werewolf-ai-presets"

export type AIModelPreset = {
  id: string
  name: string
  provider: AIProvider
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
}

const AI_PROVIDER_PRESETS: Record<Exclude<AIProvider, "mock">, { label: string; baseUrl: string; model: string }> = {
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  doubao: { label: "Doubao", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-seed-1-8" },
  glm: { label: "GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4.7" },
  mimo: { label: "MiMo", baseUrl: "https://api.xiaomimimo.com/v1", model: "mimo-v2-pro" },
  kimi: { label: "Kimi", baseUrl: "https://api.moonshot.cn/v1", model: "kimi-k2.5" },
  gpt: { label: "GPT", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  custom: { label: "自定义", baseUrl: "", model: "" },
}

const DEFAULT_PRESETS: AIModelPreset[] = [
  { id: "mock", name: "mock", provider: "mock", baseUrl: "", apiKey: "", model: "", temperature: 0.7 },
]

function loadPresets(): AIModelPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_PRESETS
    const parsed = JSON.parse(raw) as AIModelPreset[]
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_PRESETS
    // Ensure mock preset exists
    if (!parsed.find((p) => p.id === "mock")) {
      parsed.unshift(DEFAULT_PRESETS[0])
    }
    return parsed
  } catch {
    return DEFAULT_PRESETS
  }
}

function savePresets(presets: AIModelPreset[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets))
}

function generateId() {
  return `preset_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

export type AiPresetManagerProps = {
  presets: AIModelPreset[]
  onChange: (presets: AIModelPreset[]) => void
}

export default function AiPresetManager({ presets, onChange }: AiPresetManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; message: string } | null>(null)

  const updatePresets = useCallback(
    (next: AIModelPreset[]) => {
      savePresets(next)
      onChange(next)
    },
    [onChange],
  )

  const addPreset = () => {
    const id = generateId()
    const newPreset: AIModelPreset = {
      id,
      name: "新模型",
      provider: "custom",
      baseUrl: "",
      apiKey: "",
      model: "",
      temperature: 0.7,
    }
    const next = [...presets, newPreset]
    updatePresets(next)
    setEditingId(id)
  }

  const deletePreset = (id: string) => {
    if (id === "mock") return
    const next = presets.filter((p) => p.id !== id)
    updatePresets(next)
    if (editingId === id) setEditingId(null)
  }

  const updatePreset = (id: string, patch: Partial<AIModelPreset>) => {
    const next = presets.map((p) => (p.id === id ? { ...p, ...patch } : p))
    updatePresets(next)
  }

  const testPreset = async (preset: AIModelPreset) => {
    if (preset.provider === "mock") {
      setTestResult({ id: preset.id, success: true, message: "mock 模式无需测试" })
      return
    }
    setTestingId(preset.id)
    setTestResult(null)
    try {
      const res = await fetch("/api/test-ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseUrl: preset.baseUrl,
          apiKey: preset.apiKey,
          model: preset.model,
          temperature: preset.temperature,
        }),
      })
      const data = (await res.json()) as { success: boolean; content?: string; error?: string }
      setTestResult({
        id: preset.id,
        success: data.success,
        message: data.success ? `连通成功：${data.content?.slice(0, 50) ?? ""}` : `连通失败：${data.error ?? ""}`,
      })
    } catch (e) {
      setTestResult({ id: preset.id, success: false, message: `请求异常：${(e as Error).message}` })
    } finally {
      setTestingId(null)
    }
  }

  const editingPreset = presets.find((p) => p.id === editingId)

  return (
    <div className="space-y-3">
      {/* Preset list */}
      <div className="space-y-2">
        {presets.map((preset) => {
          const isEditing = editingId === preset.id
          const isTesting = testingId === preset.id
          const lastResult = testResult?.id === preset.id ? testResult : null
          return (
            <div
              key={preset.id}
              className={cn(
                "rounded-lg border px-3 py-2 transition",
                isEditing ? "border-white/25 bg-white/[0.04]" : "border-white/10 bg-white/[0.02]",
              )}
            >
              {isEditing ? (
                <PresetEditForm
                  preset={preset}
                  onChange={(patch) => updatePreset(preset.id, patch)}
                  onSave={() => setEditingId(null)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="truncate text-sm font-medium text-white/80">{preset.name}</span>
                    <span
                      className={cn(
                        "shrink-0 rounded px-1.5 py-0.5 text-[10px] tracking-wider",
                        preset.provider === "mock"
                          ? "bg-white/10 text-white/50"
                          : "bg-emerald-500/15 text-emerald-300/80",
                      )}
                    >
                      {preset.provider === "mock" ? "MOCK" : AI_PROVIDER_PRESETS[preset.provider]?.label ?? preset.provider}
                    </span>
                    {preset.provider !== "mock" && (
                      <span className="truncate text-xs text-white/40">{preset.model || "未设置模型"}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {lastResult && (
                      <span
                        className={cn(
                          "mr-1 max-w-[140px] truncate text-[10px]",
                          lastResult.success ? "text-emerald-400/70" : "text-rose-400/70",
                        )}
                        title={lastResult.message}
                      >
                        {lastResult.message}
                      </span>
                    )}
                    <button
                      className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white/80 disabled:opacity-50"
                      title="测试连通性"
                      disabled={isTesting}
                      onClick={() => testPreset(preset)}
                    >
                      {isTesting ? <Loader2 size={13} className="animate-spin" /> : lastResult?.success ? <Wifi size={13} className="text-emerald-400/60" /> : <WifiOff size={13} />}
                    </button>
                    <button
                      className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white/80"
                      title="编辑"
                      onClick={() => setEditingId(preset.id)}
                    >
                      <Pencil size={13} />
                    </button>
                    {preset.id !== "mock" && (
                      <button
                        className="rounded p-1 text-white/40 hover:bg-rose-500/20 hover:text-rose-300/80"
                        title="删除"
                        onClick={() => deletePreset(preset.id)}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <button
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-white/15 bg-white/[0.02] py-2 text-xs text-white/50 transition hover:border-white/25 hover:bg-white/[0.04] hover:text-white/70"
        onClick={addPreset}
      >
        <Plus size={14} />
        <span>添加模型</span>
      </button>
    </div>
  )
}

function PresetEditForm({
  preset,
  onChange,
  onSave,
  onCancel,
}: {
  preset: AIModelPreset
  onChange: (patch: Partial<AIModelPreset>) => void
  onSave: () => void
  onCancel: () => void
}) {
  const isMock = preset.provider === "mock"

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="text-[11px] tracking-wider text-white/45">名称</label>
          <input
            className="mt-1 w-full rounded-md border border-white/15 bg-black/30 px-2 py-1 text-sm text-white/80 outline-none focus:border-white/30"
            value={preset.name}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </div>
        <div>
          <label className="text-[11px] tracking-wider text-white/45">厂商</label>
          <select
            className="mt-1 w-full rounded-md border border-white/15 bg-black/30 px-2 py-1 text-sm text-white/80"
            value={preset.provider}
            onChange={(e) => {
              const provider = e.target.value as AIProvider
              if (provider === "mock") {
                onChange({ provider: "mock", baseUrl: "", apiKey: "", model: "", temperature: 0.7 })
                return
              }
              const p = AI_PROVIDER_PRESETS[provider]
              onChange({
                provider,
                baseUrl: p?.baseUrl ?? preset.baseUrl ?? "",
                model: p?.model ?? preset.model ?? "",
              })
            }}
          >
            <option value="mock">mock</option>
            <option value="deepseek">DeepSeek</option>
            <option value="doubao">Doubao</option>
            <option value="glm">GLM</option>
            <option value="mimo">MiMo</option>
            <option value="kimi">Kimi</option>
            <option value="gpt">GPT</option>
            <option value="custom">自定义</option>
          </select>
        </div>
        {!isMock && (
          <>
            <div>
              <label className="text-[11px] tracking-wider text-white/45">Base URL</label>
              <input
                className="mt-1 w-full rounded-md border border-white/15 bg-black/30 px-2 py-1 text-sm text-white/80 outline-none focus:border-white/30"
                value={preset.baseUrl}
                placeholder={AI_PROVIDER_PRESETS[preset.provider as Exclude<AIProvider, "mock">]?.baseUrl ?? "https://..."}
                onChange={(e) => onChange({ baseUrl: e.target.value })}
              />
            </div>
            <div>
              <label className="text-[11px] tracking-wider text-white/45">API Key</label>
              <input
                type="password"
                className="mt-1 w-full rounded-md border border-white/15 bg-black/30 px-2 py-1 text-sm text-white/80 outline-none focus:border-white/30"
                value={preset.apiKey}
                placeholder="sk-..."
                onChange={(e) => onChange({ apiKey: e.target.value })}
              />
            </div>
            <div>
              <label className="text-[11px] tracking-wider text-white/45">Model</label>
              <input
                className="mt-1 w-full rounded-md border border-white/15 bg-black/30 px-2 py-1 text-sm text-white/80 outline-none focus:border-white/30"
                value={preset.model}
                placeholder={AI_PROVIDER_PRESETS[preset.provider as Exclude<AIProvider, "mock">]?.model ?? "model-name"}
                onChange={(e) => onChange({ model: e.target.value })}
              />
            </div>
            <div>
              <label className="text-[11px] tracking-wider text-white/45">Temperature</label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.1}
                  className="h-1 flex-1 appearance-none rounded bg-white/20 accent-white"
                  value={preset.temperature}
                  onChange={(e) => onChange({ temperature: Number(e.target.value) })}
                />
                <span className="w-10 text-right text-xs text-white/60">{preset.temperature}</span>
              </div>
            </div>
          </>
        )}
      </div>
      <div className="flex items-center justify-end gap-2">
        <button
          className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-black/30 px-3 py-1 text-xs text-white/60 hover:bg-white/10 hover:text-white/80"
          onClick={onCancel}
        >
          <X size={12} />
          取消
        </button>
        <button
          className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/10 px-3 py-1 text-xs text-white/80 hover:bg-white/15"
          onClick={onSave}
        >
          <Check size={12} />
          保存
        </button>
      </div>
    </div>
  )
}

export { AI_PROVIDER_PRESETS, loadPresets, savePresets }
