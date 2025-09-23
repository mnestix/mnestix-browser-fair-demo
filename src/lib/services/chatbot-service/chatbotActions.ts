'use server';

import { ApiResponseWrapper, wrapErrorCode, wrapSuccess } from 'lib/util/apiResponseWrapper/apiResponseWrapper';
import { ApiResultStatus } from 'lib/util/apiResponseWrapper/apiResultStatus';
import { createRequestLogger, logInfo } from 'lib/util/Logger';
import { headers } from 'next/headers';
import { envs } from 'lib/env/MnestixEnv';

export type ChatbotResponse = {
    output: string;
    status?: string;
};

export async function sendChatMessage(
    chatInput: string,
    sessionId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    aasContext?: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    submodelsContext?: any[],
): Promise<ApiResponseWrapper<ChatbotResponse>> {
    const logger = createRequestLogger(await headers());
    logInfo(logger, 'sendChatMessage', 'Sending message to chatbot', {
        messageLength: chatInput.length,
        sessionId,
        hasAasContext: !!aasContext,
        submodelsCount: submodelsContext?.length || 0,
    });

    try {
        const n8nApiUrl = envs.N8N_API_URL;
        if (!n8nApiUrl) {
            return wrapErrorCode(
                ApiResultStatus.INTERNAL_SERVER_ERROR,
                'N8N_API_URL environment variable is not configured',
            );
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const requestBody: any = {
            chatInput,
            sessionId,
        };

        const response = await fetch(n8nApiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ApiKey: envs.N8N_API_KEY || '',
            },
            body: JSON.stringify(requestBody),
        });

        logger.debug(
            {
                Request_Url: n8nApiUrl,
                Http_Status: response?.status,
                Http_Message: response?.statusText,
            },
            'Chatbot API response received',
        );

        if (!response.ok) {
            return wrapErrorCode(
                ApiResultStatus.UNKNOWN_ERROR,
                `Chatbot API responded with status ${response.status}: ${response.statusText}`,
                response.status,
            );
        }

        const result = await response.json();
        return wrapSuccess(result, response.status);
    } catch (error) {
        logger.error({ error }, 'Failed to send message to chatbot');
        return wrapErrorCode(
            ApiResultStatus.UNKNOWN_ERROR,
            error instanceof Error ? error.message : 'Unknown error occurred while contacting chatbot',
        );
    }
}
