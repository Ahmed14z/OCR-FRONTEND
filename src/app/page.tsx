"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type ParseResult = {
  page: number;
  total_pages: number;
  structure_markdown: string;
  vlm_markdown: string;
  rendered_html: string;
  ocr_elapsed_s: number;
  total_elapsed_s: number;
};

type SSEEvent = {
  status: string;
  elapsed?: number;
  message?: string;
  result?: ParseResult;
};

const STATUS_LABELS: Record<string, string> = {
  uploading: "Uploading file...",
  converting_pdf: "Preparing document...",
  running_structure_ocr: "Extracting structure...",
  running_vlm: "Analyzing content...",
  correcting_korean: "Refining Korean text...",
  rendering: "Rendering output...",
  processing: "Processing...",
  complete: "Complete!",
  error: "Error",
};

function wrapMarkdownAsHtml(markdown: string): string {
  // Escape HTML entities so raw markdown renders as plain text in a styled page
  const escaped = markdown
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return `<!DOCTYPE html>
<html><head><style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         font-size: 14px; line-height: 1.6; padding: 24px; margin: 0;
         color: #1a1a1a; background: #fff; white-space: pre-wrap; word-wrap: break-word; }
</style></head><body>${escaped}</body></html>`;
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageMode, setPageMode] = useState<"all" | "single">("all");
  const [statusText, setStatusText] = useState<string>("");
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"normal" | "diff">("normal");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-open modal when results arrive
  useEffect(() => {
    if (result) {
      setModalOpen(true);
    }
  }, [result]);

  const handleFile = useCallback((f: File) => {
    setFile(f);
    setError(null);
    setResult(null);

    if (f.type.startsWith("image/")) {
      const url = URL.createObjectURL(f);
      setPreview(url);
    } else {
      setPreview(null);
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  const handleParse = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setStatusText("Uploading...");
    setElapsed(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("page", String(pageMode === "all" ? -1 : page - 1));

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${API_URL}/api/parse`, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(errBody.detail || "Parse failed");
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error("No response stream available");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed) continue;

          const dataLine = trimmed
            .split("\n")
            .find((line) => line.startsWith("data: "));
          if (!dataLine) continue;

          const jsonStr = dataLine.slice("data: ".length);
          let event: SSEEvent;
          try {
            event = JSON.parse(jsonStr) as SSEEvent;
          } catch {
            continue;
          }

          const label = event.message || STATUS_LABELS[event.status] || event.status;

          if (event.status === "error") {
            throw new Error(event.message ?? "OCR processing failed");
          }

          if (event.status === "complete" && event.result) {
            setResult(event.result);
            setStatusText("Complete!");
          } else {
            setStatusText(
              event.elapsed != null
                ? `${label} (${event.elapsed.toFixed(1)}s)`
                : label
            );
            if (event.elapsed != null) {
              setElapsed(event.elapsed);
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Request cancelled");
      } else {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  return (
    <main className="min-h-screen bg-background p-6 md:p-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">Document OCR</h1>
          <p className="text-muted-foreground">
            Upload a PDF or image to extract and parse document content
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Upload Document</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              onDrop={onDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              className="flex min-h-[200px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 bg-muted/50 p-6 transition-colors hover:border-muted-foreground/50 hover:bg-muted"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
              {file ? (
                <div className="text-center space-y-2">
                  <p className="font-medium">{file.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {(file.size / 1024 / 1024).toFixed(1)} MB
                  </p>
                  <Badge variant="secondary">
                    {file.type === "application/pdf" ? "PDF" : "Image"}
                  </Badge>
                </div>
              ) : (
                <div className="text-center space-y-2">
                  <div className="text-4xl text-muted-foreground/50">+</div>
                  <p className="text-sm text-muted-foreground">
                    Drop PDF or image here, or click to browse
                  </p>
                </div>
              )}
            </div>

            {preview && (
              <div className="overflow-hidden rounded-lg border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={preview}
                  alt="Preview"
                  className="w-full object-contain max-h-[400px]"
                />
              </div>
            )}

            {file?.type === "application/pdf" && (
              <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-2">
                <span className="text-sm font-medium text-muted-foreground pl-1">
                  Pages:
                </span>
                <button
                  type="button"
                  onClick={() => setPageMode("all")}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    pageMode === "all"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setPageMode("single")}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    pageMode === "single"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  Single
                </button>
                {pageMode === "single" && (
                  <input
                    type="number"
                    min={1}
                    value={page}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (v >= 1) setPage(v);
                    }}
                    className="w-16 rounded-md border bg-background px-2 py-1.5 text-sm text-center"
                  />
                )}
              </div>
            )}

            <div className="flex items-center gap-3">
              {result && (
                <Button
                  variant="outline"
                  onClick={() => setModalOpen(true)}
                >
                  View Results
                </Button>
              )}
              <Button
                onClick={handleParse}
                disabled={!file || loading}
                className="ml-auto"
              >
                {loading ? "Parsing..." : "Parse Document"}
              </Button>
            </div>

            {loading && (
              <div className="flex items-center gap-3 rounded-md border bg-muted/30 p-4">
                <div className="animate-spin text-xl">&#9696;</div>
                <div>
                  <p className="text-sm font-medium">{statusText}</p>
                  {elapsed != null && (
                    <p className="text-xs text-muted-foreground">
                      Elapsed: {elapsed.toFixed(1)}s
                    </p>
                  )}
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Results Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-[96vw] sm:max-w-[96vw] w-[96vw] h-[92vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
            <div className="flex items-center justify-between pr-8">
              <div className="flex items-center gap-3">
                <DialogTitle className="text-xl">Parsed Output</DialogTitle>
                {result && (
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      {result.page === -1
                        ? `All ${result.total_pages} pages`
                        : `Page ${result.page + 1} of ${result.total_pages}`}
                    </Badge>
                    <Badge variant="secondary">
                      {result.total_elapsed_s}s
                    </Badge>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 rounded-lg border bg-muted/30 p-1">
                <button
                  type="button"
                  onClick={() => setViewMode("normal")}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    viewMode === "normal"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  Normal View
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("diff")}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    viewMode === "diff"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  Diff View
                </button>
              </div>
            </div>
            <DialogDescription className="sr-only">
              View the parsed OCR output of your document
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-hidden">
            {result && viewMode === "normal" && (
              <Tabs defaultValue="rendered" className="flex flex-col h-full">
                <TabsList className="mx-6 mt-4 w-fit shrink-0">
                  <TabsTrigger value="rendered">Form View</TabsTrigger>
                  <TabsTrigger value="markdown">Raw Text</TabsTrigger>
                  {result.vlm_markdown && (
                    <TabsTrigger value="vlm">Visual Analysis</TabsTrigger>
                  )}
                </TabsList>

                <TabsContent value="rendered" className="flex-1 min-h-0 px-6 pb-6">
                  <div className="h-full rounded-md border overflow-hidden">
                    <iframe
                      srcDoc={result.rendered_html}
                      className="w-full h-full border-0"
                      title="Rendered form"
                    />
                  </div>
                </TabsContent>

                <TabsContent value="markdown" className="flex-1 min-h-0 px-6 pb-6">
                  <ScrollArea className="h-full rounded-md border">
                    <pre className="p-4 text-sm font-mono whitespace-pre-wrap">
                      {result.structure_markdown || "No markdown output"}
                    </pre>
                  </ScrollArea>
                </TabsContent>

                {result.vlm_markdown && (
                  <TabsContent value="vlm" className="flex-1 min-h-0 px-6 pb-6">
                    <ScrollArea className="h-full rounded-md border">
                      <pre className="p-4 text-sm font-mono whitespace-pre-wrap">
                        {result.vlm_markdown}
                      </pre>
                    </ScrollArea>
                  </TabsContent>
                )}
              </Tabs>
            )}

            {result && viewMode === "diff" && (
              <div className="grid grid-cols-2 gap-4 h-full px-6 py-4">
                <div className="flex flex-col min-h-0">
                  <div className="flex items-center gap-2 mb-2 shrink-0">
                    <h3 className="text-sm font-semibold">Structure OCR</h3>
                    <Badge variant="outline" className="text-xs">Original</Badge>
                  </div>
                  <div className="flex-1 rounded-md border overflow-hidden">
                    <iframe
                      srcDoc={wrapMarkdownAsHtml(result.structure_markdown)}
                      className="w-full h-full border-0"
                      title="Structure OCR rendered"
                    />
                  </div>
                </div>
                <div className="flex flex-col min-h-0">
                  <div className="flex items-center gap-2 mb-2 shrink-0">
                    <h3 className="text-sm font-semibold">Final Output</h3>
                    <Badge variant="secondary" className="text-xs">Refined</Badge>
                  </div>
                  <div className="flex-1 rounded-md border overflow-hidden">
                    <iframe
                      srcDoc={result.rendered_html}
                      className="w-full h-full border-0"
                      title="Final rendered output"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
