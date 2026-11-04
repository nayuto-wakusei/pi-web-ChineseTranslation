import { describe, expect, it } from "vitest";
import {
  MAX_SPEECH_RECORDING_MS,
  normalizeSpeechMimeType,
  parseSpeechTranscriptionRequest,
  speechAudioFilename,
} from "./speechTranscription";

const audio = { mimeType: "audio/webm;codecs=opus", data: Buffer.from("hello").toString("base64") };

describe("speech transcription contract", () => {
  it("normalizes recorded container types and keeps a usable filename", () => {
    expect(normalizeSpeechMimeType("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(normalizeSpeechMimeType(" AUDIO/OGG ")).toBe("audio/ogg");
    expect(normalizeSpeechMimeType(undefined)).toBeUndefined();
    expect(speechAudioFilename("audio/webm;codecs=opus")).toBe("audio.webm");
    expect(speechAudioFilename("audio/mp4")).toBe("audio.m4a");
    expect(speechAudioFilename("audio/mpeg")).toBe("audio.mp3");
    expect(speechAudioFilename("audio/wav")).toBe("audio.wav");
  });

  it("accepts a recorded utterance and reports its normalized type", () => {
    expect(parseSpeechTranscriptionRequest({ cwd: "/repo", audio, durationMs: 1200 }, { maxAudioBytes: 1024 })).toEqual({
      cwd: "/repo",
      audio: { mimeType: "audio/webm", data: audio.data },
      durationMs: 1200,
    });
  });

  it("rejects malformed or unsupported payloads", () => {
    const options = { maxAudioBytes: 1024 };
    expect(() => parseSpeechTranscriptionRequest(undefined, options)).toThrow(/object/u);
    expect(() => parseSpeechTranscriptionRequest({ cwd: "", audio }, options)).toThrow(/cwd/u);
    expect(() => parseSpeechTranscriptionRequest({ cwd: "/repo" }, options)).toThrow(/audio/u);
    expect(() => parseSpeechTranscriptionRequest({ cwd: "/repo", audio: { ...audio, mimeType: "video/mp4" } }, options)).toThrow(/supported/u);
    expect(() => parseSpeechTranscriptionRequest({ cwd: "/repo", audio: { ...audio, data: "" } }, options)).toThrow(/base64/u);
    expect(() => parseSpeechTranscriptionRequest({ cwd: "/repo", audio: { ...audio, data: "not base64!" } }, options)).toThrow(/base64/u);
    expect(() => parseSpeechTranscriptionRequest({ cwd: "/repo", audio, durationMs: MAX_SPEECH_RECORDING_MS + 1 }, options)).toThrow(/durationMs/u);
  });

  it("enforces the decoded size limit rather than the base64 length", () => {
    const fiveBytes = Buffer.from("12345").toString("base64");
    expect(() => parseSpeechTranscriptionRequest({ cwd: "/repo", audio: { mimeType: "audio/wav", data: fiveBytes } }, { maxAudioBytes: 4 }))
      .toThrow(/size limit/u);
    expect(parseSpeechTranscriptionRequest({ cwd: "/repo", audio: { mimeType: "audio/wav", data: fiveBytes } }, { maxAudioBytes: 5 }).audio.data)
      .toBe(fiveBytes);
  });
});
