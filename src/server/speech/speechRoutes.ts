import type { FastifyInstance } from "fastify";
import { userFacingErrorMessage, type Translator } from "../../shared/i18n.js";
import { loadNodeTranslator } from "../../localization.js";
import { parseSpeechTranscriptionRequest } from "../../shared/speechTranscription.js";
import { withRequestCancellation } from "../requestCancellation.js";
import { SpeechTranscriptionFailure, type SpeechTranscriptionService } from "./transcriptionService.js";

export interface SpeechRouteDependencies {
  speech: SpeechTranscriptionService;
}

/**
 * Dictation endpoint for the composer. The browser owns capture; this route only
 * validates the payload and forwards it to the configured speech service, so it
 * carries no session state.
 */
export function registerSpeechRoutes(
  app: FastifyInstance,
  deps: SpeechRouteDependencies,
  prefix = "",
  t: Translator = loadNodeTranslator("server"),
): void {
  app.post<{ Body: unknown }>(`${prefix}/speech/transcriptions`, async (request, reply) => {
    try {
      const body = parseSpeechTranscriptionRequest(request.body, { maxAudioBytes: deps.speech.maxAudioBytes });
      const text = await withRequestCancellation(request, reply, (signal) =>
        deps.speech.transcribe({ mimeType: body.audio.mimeType, data: body.audio.data }, signal));
      return { text };
    } catch (error) {
      if (error instanceof SpeechTranscriptionFailure) return reply.code(error.status).send({ error: error.message });
      return reply.code(400).send({ error: userFacingErrorMessage(error, t) });
    }
  });
}
