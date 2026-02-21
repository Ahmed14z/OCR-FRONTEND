"use client";

import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

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

        // SSE events are separated by double newlines
        const parts = buffer.split("\n\n");
        // Keep the last (possibly incomplete) chunk in the buffer
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed) continue;

          // Each SSE event line starts with "data: "
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

          // Update UI based on event status
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
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">
            Document OCR
          </h1>
          <p className="text-muted-foreground">
            Upload a PDF or image to extract and parse document content
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Left: Upload */}
          <div className="space-y-4">
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
                    <span className="text-sm font-medium text-muted-foreground pl-1">Pages:</span>
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
                  <Button
                    onClick={handleParse}
                    disabled={!file || loading}
                    className="ml-auto"
                  >
                    {loading ? "Parsing..." : "Parse Document"}
                  </Button>
                </div>

                {error && (
                  <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                    {error}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right: Results */}
          <div className="space-y-4">
            <Card className="h-full">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Parsed Output</CardTitle>
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
              </CardHeader>
              <CardContent>
                {result ? (
                  <Tabs defaultValue="rendered">
                    <TabsList>
                      <TabsTrigger value="rendered">Form View</TabsTrigger>
                      <TabsTrigger value="markdown">Raw Text</TabsTrigger>
                      {result.vlm_markdown && (
                        <TabsTrigger value="vlm">Visual Analysis</TabsTrigger>
                      )}
                    </TabsList>

                    <TabsContent value="rendered">
                      <ScrollArea className="h-[600px] rounded-md border">
                        <iframe
                          srcDoc={result.rendered_html}
                          className="w-full h-[600px] border-0"
                          title="Rendered form"
                        />
                      </ScrollArea>
                    </TabsContent>

                    <TabsContent value="markdown">
                      <ScrollArea className="h-[600px] rounded-md border">
                        <pre className="p-4 text-xs font-mono whitespace-pre-wrap">
                          {result.structure_markdown || "No markdown output"}
                        </pre>
                      </ScrollArea>
                    </TabsContent>

                    {result.vlm_markdown && (
                      <TabsContent value="vlm">
                        <ScrollArea className="h-[600px] rounded-md border">
                          <pre className="p-4 text-xs font-mono whitespace-pre-wrap">
                            {result.vlm_markdown}
                          </pre>
                        </ScrollArea>
                      </TabsContent>
                    )}
                  </Tabs>
                ) : (
                  <div className="flex h-[600px] items-center justify-center text-muted-foreground">
                    {loading ? (
                      <div className="space-y-3 text-center">
                        <div className="animate-spin text-3xl">&#9696;</div>
                        <p className="text-sm font-medium">{statusText}</p>
                        {elapsed != null && (
                          <p className="text-xs text-muted-foreground/70">
                            Elapsed: {elapsed.toFixed(1)}s
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm">
                        Upload a document and click Parse to see results
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </main>
  );
}
