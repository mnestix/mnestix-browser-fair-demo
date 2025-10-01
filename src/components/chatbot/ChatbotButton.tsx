'use client';

import { Box, Fab, Paper, IconButton, TextField, Typography, CircularProgress, Collapse } from '@mui/material';
import { Chat, Send, Close, Mic, MicOff, VolumeUp, Stop } from '@mui/icons-material';
import { useState, useMemo, useEffect, useRef } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { sendChatMessage } from 'lib/services/chatbot-service/chatbotActions';
import { useNotificationSpawner } from 'lib/hooks/UseNotificationSpawner';
import { useCurrentAasContext } from 'components/contexts/CurrentAasContext';
import { useIsMobile } from 'lib/hooks/UseBreakpoints';
import SpeechRecognition, { useSpeechRecognition } from 'react-speech-recognition';

export function ChatbotButton() {
    const [isOpen, setIsOpen] = useState(false);
    const [message, setMessage] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [chatHistory, setChatHistory] = useState<Array<{ type: 'user' | 'bot'; message: string }>>([]);
    const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
    const { spawn } = useNotificationSpawner();
    const t = useTranslations('components.chatbot');
    const locale = useLocale();
    const context = useCurrentAasContext();
    const { aas, submodels, aasOriginUrl } = context || {};
    const chatContainerRef = useRef<HTMLDivElement>(null);
    const { transcript, listening, resetTranscript, browserSupportsSpeechRecognition } = useSpeechRecognition();
    const speechSynthesisRef = useRef<SpeechSynthesisUtterance | null>(null);
    const [isVoiceLoaded, setVoiceLoaded] = useState(false);
    const isMobile = useIsMobile();

    window.speechSynthesis.onvoiceschanged = function () {
        setVoiceLoaded(window.speechSynthesis.getVoices().length > 0);
    };

    useEffect(() => {
        if (!isVoiceLoaded) {
            window.speechSynthesis.getVoices();
        }
    }, []);

    /**
     * Map locale to BCP47 language tags for better voice matching
     */
    function getLanguageTag(locale: string): string {
        const localeMap: Record<string, string> = {
            en: 'en-US',
            de: 'de-DE',
            es: 'es-ES',
        };
        return localeMap[locale] || locale;
    }

    /**
     * Select the best available voice for the given language
     * Prefers Google voices or neural voices over default system voices
     */
    function selectBestVoice(languageTag: string): SpeechSynthesisVoice | null {
        const voices = window.speechSynthesis.getVoices();
        if (voices.length === 0) return null;

        // Try to find voices that match the language
        const languageVoices = voices.filter((voice) => voice.lang.startsWith(languageTag.split('-')[0]));

        if (languageVoices.length === 0) {
            return voices[0]; // Fallback to first available voice
        }

        // Priority 1: Look for Google voices (high quality, cross-browser)
        const googleVoice = languageVoices.find((voice) => voice.name.toLowerCase().includes('google'));
        if (googleVoice) return googleVoice;

        // Priority 2: Look for neural/premium voices (indicated by common keywords)
        const premiumVoice = languageVoices.find((voice) => {
            const nameLower = voice.name.toLowerCase();
            return nameLower.includes('neural') || nameLower.includes('enhanced') || nameLower.includes('premium');
        });
        if (premiumVoice) return premiumVoice;

        // Priority 3: Look for natural-sounding voices by common names
        const naturalVoice = languageVoices.find((voice) => {
            const nameLower = voice.name.toLowerCase();
            return (
                nameLower.includes('samantha') ||
                nameLower.includes('alex') ||
                nameLower.includes('daniel') ||
                nameLower.includes('fiona') ||
                nameLower.includes('karen') ||
                nameLower.includes('tessa') ||
                nameLower.includes('monica') ||
                nameLower.includes('paulina') ||
                nameLower.includes('anna') ||
                nameLower.includes('helena')
            );
        });
        if (naturalVoice) return naturalVoice;

        // Priority 4: Prefer local voices over remote ones (better performance)
        const localVoice = languageVoices.find((voice) => voice.localService);
        if (localVoice) return localVoice;

        // Fallback: Return first voice that matches the language
        return languageVoices[0];
    }

    // Sync transcript to message field
    useEffect(() => {
        if (transcript) {
            setMessage(transcript);
        }
    }, [transcript]);

    // Generate a unique session ID based on AAS ID and component instance
    const sessionId = useMemo(() => {
        const aasId = aas?.id;
        const timestamp = Date.now();
        const randomSuffix = Math.random().toString(36).substring(2, 8);
        return `${aasId}-${timestamp}-${randomSuffix}`;
    }, [aas?.id]);

    // Clear chat history when AAS changes to maintain separate conversations per AAS
    useEffect(() => {
        setChatHistory([
            {
                type: 'bot',
                message: t('chatbot-greeting'),
            },
        ]);
    }, [aas?.id]);

    // Auto-scroll to bottom when new messages are added
    const scrollToBottom = () => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    };

    // Scroll to bottom whenever chat history or loading state changes
    useEffect(() => {
        scrollToBottom();
    }, [chatHistory, isLoading]);

    const toggleChat = () => {
        setIsOpen(!isOpen);
    };

    const closeChat = () => {
        setIsOpen(false);
        setMessage('');
    };

    const handleSendMessage = async () => {
        stopListening();
        if (!message.trim() || isLoading) return;

        const userMessage = message.trim();
        setMessage('');
        setIsLoading(true);

        // Add user message to chat history
        setChatHistory((prev) => [...prev, { type: 'user', message: userMessage }]);

        try {
            // Prepare context data - only send actual submodel data, not errors
            const submodelsData = (submodels ?? [])
                .filter((sm) => sm.submodel) // Only include submodels that loaded successfully
                .map((sm) => sm.submodel);

            const response = await sendChatMessage(userMessage, sessionId, aas, submodelsData, aasOriginUrl, locale);

            if (response.isSuccess) {
                // Add bot response to chat history
                setChatHistory((prev) => [
                    ...prev,
                    { type: 'bot', message: response.result.output || t('responses.defaultResponse') },
                ]);
            } else {
                // Add error message to chat history
                setChatHistory((prev) => [...prev, { type: 'bot', message: t('responses.errorResponse') }]);
                spawn({
                    title: t('errors.title'),
                    message: response.message || t('errors.unknownError'),
                    severity: 'error',
                });
            }
        } catch {
            setChatHistory((prev) => [...prev, { type: 'bot', message: t('responses.errorResponse') }]);
            spawn({
                title: t('errors.title'),
                message: t('errors.networkError'),
                severity: 'error',
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyPress = (event: React.KeyboardEvent) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            handleSendMessage();
        }
    };

    function startListening() {
        resetTranscript();
        SpeechRecognition.startListening({ continuous: true });
    }

    function stopListening() {
        SpeechRecognition.stopListening();
    }

    function toggleListening() {
        if (listening) {
            stopListening();
        } else {
            startListening();
        }
    }

    function handleSpeak(text: string, index: number) {
        // Stop any ongoing speech
        if (speechSynthesisRef.current) {
            window.speechSynthesis.cancel();
            setSpeakingIndex(null);
            speechSynthesisRef.current = null;
            return;
        }

        // Remove markdown formatting for cleaner speech
        const cleanText = text
            .replace(/[#*_~`]/g, '') // Remove markdown symbols
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Convert links to just text
            .replace(/\n+/g, '. ') // Convert line breaks to pauses
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();

        const utterance = new SpeechSynthesisUtterance(cleanText);

        // Set language
        const languageTag = getLanguageTag(locale);
        utterance.lang = languageTag;

        // Select best available voice
        const bestVoice = selectBestVoice(languageTag);
        if (bestVoice) {
            utterance.voice = bestVoice;
        }

        // Optimize speech parameters for more natural sound
        utterance.rate = 0.95; // Slightly slower than default for clarity
        utterance.pitch = 1.0; // Natural pitch
        utterance.volume = 1.0; // Full volume

        utterance.onend = function handleSpeechEnd() {
            setSpeakingIndex(null);
            speechSynthesisRef.current = null;
        };

        utterance.onerror = function handleSpeechError(event: SpeechSynthesisErrorEvent) {
            console.log(event.error);
            setSpeakingIndex(null);
            speechSynthesisRef.current = null;
            if (event.error != 'interrupted') {
                spawn({
                    title: t('errors.title'),
                    message: t('errors.ttsError'),
                    severity: 'error',
                });
            }
        };

        speechSynthesisRef.current = utterance;
        setSpeakingIndex(index);
        window.speechSynthesis.speak(utterance);
    }

    // Stop speech when component unmounts or chat closes
    useEffect(() => {
        return function cleanup() {
            if (speechSynthesisRef.current) {
                window.speechSynthesis.cancel();
                speechSynthesisRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (!isOpen && speechSynthesisRef.current) {
            window.speechSynthesis.cancel();
            setSpeakingIndex(null);
            speechSynthesisRef.current = null;
        }
    }, [isOpen]);

    return (
        <>
            {/* Floating Chat Button */}
            <Fab
                color="primary"
                sx={{
                    position: 'fixed',
                    bottom: 24,
                    right: 24,
                    zIndex: 1000,
                    display: isOpen && isMobile ? 'none' : 'flex', // Hide on mobile when chat is open
                }}
                onClick={toggleChat}
                data-testid="chatbot-fab"
            >
                <Chat />
            </Fab>

            {/* Chat Window */}
            <Collapse in={isOpen}>
                <Paper
                    sx={{
                        position: 'fixed',
                        ...(isMobile
                            ? {
                                  top: 0,
                                  left: 0,
                                  right: 0,
                                  bottom: 0,
                                  width: '100vw',
                                  height: '100dvh', // Use dynamic viewport height
                                  borderRadius: 0,
                                  zIndex: 1300,
                              }
                            : {
                                  bottom: 90,
                                  right: 24,
                                  width: 400,
                                  height: 500,
                                  zIndex: 999,
                              }),
                        display: 'flex',
                        flexDirection: 'column',
                        boxShadow: 3,
                    }}
                    data-testid="chatbot-window"
                >
                    {/* Chat Header */}
                    <Box
                        sx={{
                            p: 2,
                            borderBottom: '1px solid',
                            borderColor: 'grey.300',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            backgroundColor: 'primary.main',
                            color: 'primary.contrastText',
                            flexShrink: 0, // Prevent header from shrinking
                        }}
                    >
                        <Typography variant="h6">{t('title')}</Typography>
                        <IconButton size="small" onClick={closeChat} sx={{ color: 'inherit' }}>
                            <Close />
                        </IconButton>
                    </Box>

                    {/* Chat Messages */}
                    <Box
                        ref={chatContainerRef}
                        sx={{
                            flex: 1,
                            overflowY: 'auto',
                            p: 2,
                            backgroundColor: 'grey.50',
                            minHeight: 0, // Allow flex child to shrink
                        }}
                    >
                        {chatHistory.length === 0 ? (
                            <Typography color="text.secondary">{t('placeholder')}</Typography>
                        ) : (
                            chatHistory.map((entry, index) => (
                                <Box key={index} sx={{ mb: 2 }}>
                                    <Box
                                        sx={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                        }}
                                    >
                                        <Typography
                                            variant="body2"
                                            sx={{
                                                fontWeight: 'bold',
                                                color: entry.type === 'user' ? 'primary.main' : 'secondary.main',
                                            }}
                                        >
                                            {entry.type === 'user' ? t('labels.you') : t('labels.assistant')}:
                                        </Typography>
                                        {entry.type === 'bot' && (
                                            <IconButton
                                                size="small"
                                                onClick={() => handleSpeak(entry.message, index)}
                                                aria-label={speakingIndex === index ? 'stopSpeaking' : 'startSpeaking'}
                                                data-testid={`chatbot-tts-button-${index}`}
                                            >
                                                {speakingIndex === index ? (
                                                    <Stop fontSize="small" />
                                                ) : (
                                                    <VolumeUp fontSize="small" />
                                                )}
                                            </IconButton>
                                        )}
                                    </Box>
                                    <Box
                                        sx={{
                                            mt: 0.5,
                                            p: 1,
                                            borderRadius: 1,
                                            backgroundColor: entry.type === 'user' ? 'primary.light' : 'grey.200',
                                            color: entry.type === 'user' ? 'primary.contrastText' : 'text.primary',
                                        }}
                                    >
                                        {entry.type === 'user' ? (
                                            <Typography variant="body2">{entry.message}</Typography>
                                        ) : (
                                            <ReactMarkdown
                                                remarkPlugins={[remarkGfm]}
                                                components={{
                                                    p: ({ children }) => (
                                                        <Typography
                                                            variant="body2"
                                                            sx={{ mb: 1, '&:last-child': { mb: 0 } }}
                                                        >
                                                            {children}
                                                        </Typography>
                                                    ),
                                                    h1: ({ children }) => (
                                                        <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 1 }}>
                                                            {children}
                                                        </Typography>
                                                    ),
                                                    h2: ({ children }) => (
                                                        <Typography
                                                            variant="subtitle1"
                                                            sx={{ fontWeight: 'bold', mb: 1 }}
                                                        >
                                                            {children}
                                                        </Typography>
                                                    ),
                                                    h3: ({ children }) => (
                                                        <Typography
                                                            variant="subtitle2"
                                                            sx={{ fontWeight: 'bold', mb: 1 }}
                                                        >
                                                            {children}
                                                        </Typography>
                                                    ),
                                                    strong: ({ children }) => (
                                                        <Typography component="span" sx={{ fontWeight: 'bold' }}>
                                                            {children}
                                                        </Typography>
                                                    ),
                                                    em: ({ children }) => (
                                                        <Typography component="span" sx={{ fontStyle: 'italic' }}>
                                                            {children}
                                                        </Typography>
                                                    ),
                                                    code: ({ children }) => (
                                                        <Typography
                                                            component="code"
                                                            sx={{
                                                                backgroundColor: 'grey.100',
                                                                padding: '2px 4px',
                                                                borderRadius: '4px',
                                                                fontFamily: 'monospace',
                                                                fontSize: '0.875em',
                                                            }}
                                                        >
                                                            {children}
                                                        </Typography>
                                                    ),
                                                    hr: () => (
                                                        <Box
                                                            sx={{
                                                                my: 2,
                                                                borderBottom: '1px solid',
                                                                borderColor: 'grey.300',
                                                            }}
                                                        />
                                                    ),
                                                    table: ({ children }) => (
                                                        <Box
                                                            component="table"
                                                            sx={{
                                                                width: '100%',
                                                                borderCollapse: 'collapse',
                                                                mb: 2,
                                                                border: '1px solid',
                                                                borderColor: 'grey.300',
                                                                backgroundColor: 'background.paper',
                                                            }}
                                                        >
                                                            {children}
                                                        </Box>
                                                    ),
                                                    thead: ({ children }) => (
                                                        <Box
                                                            component="thead"
                                                            sx={{
                                                                backgroundColor: 'grey.100',
                                                            }}
                                                        >
                                                            {children}
                                                        </Box>
                                                    ),
                                                    tbody: ({ children }) => <Box component="tbody">{children}</Box>,
                                                    tr: ({ children }) => (
                                                        <Box
                                                            component="tr"
                                                            sx={{
                                                                borderBottom: '1px solid',
                                                                borderColor: 'grey.200',
                                                                '&:hover': {
                                                                    backgroundColor: 'grey.50',
                                                                },
                                                            }}
                                                        >
                                                            {children}
                                                        </Box>
                                                    ),
                                                    th: ({ children }) => (
                                                        <Typography
                                                            component="th"
                                                            variant="body2"
                                                            sx={{
                                                                p: 1,
                                                                fontWeight: 'bold',
                                                                textAlign: 'left',
                                                                border: '1px solid',
                                                                borderColor: 'grey.300',
                                                            }}
                                                        >
                                                            {children}
                                                        </Typography>
                                                    ),
                                                    td: ({ children }) => (
                                                        <Typography
                                                            component="td"
                                                            variant="body2"
                                                            sx={{
                                                                p: 1,
                                                                border: '1px solid',
                                                                borderColor: 'grey.300',
                                                            }}
                                                        >
                                                            {children}
                                                        </Typography>
                                                    ),
                                                }}
                                            >
                                                {entry.message}
                                            </ReactMarkdown>
                                        )}
                                    </Box>
                                </Box>
                            ))
                        )}
                        {isLoading && (
                            <Box sx={{ display: 'flex', alignItems: 'center', mt: 2 }}>
                                <CircularProgress size={16} sx={{ mr: 1 }} />
                                <Typography variant="body2" color="text.secondary">
                                    {t('loading')}
                                </Typography>
                            </Box>
                        )}
                    </Box>

                    {/* Message Input */}
                    <Box
                        sx={{
                            px: 2,
                            pt: 2,
                            borderTop: '1px solid',
                            borderColor: 'grey.300',
                            display: 'flex',
                            gap: 1,
                            flexShrink: 0, // Prevent input area from shrinking
                            backgroundColor: 'background.paper', // Ensure solid background
                            ...(isMobile && {
                                pb: 'max(env(safe-area-inset-bottom), 8px)', // Add safe area padding for mobile
                            }),
                        }}
                    >
                        <TextField
                            fullWidth
                            variant="outlined"
                            placeholder={t('inputPlaceholder')}
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            onKeyUp={handleKeyPress}
                            disabled={isLoading}
                            multiline
                            maxRows={3}
                            size="small"
                            data-testid="chatbot-input"
                        />
                        {browserSupportsSpeechRecognition && (
                            <IconButton
                                color={listening ? 'error' : 'default'}
                                onClick={toggleListening}
                                disabled={isLoading}
                                data-testid="chatbot-mic-button"
                                aria-label={listening ? t('stopListening') : t('startListening')}
                            >
                                {listening ? <MicOff /> : <Mic />}
                            </IconButton>
                        )}
                        <IconButton
                            color="primary"
                            onClick={handleSendMessage}
                            disabled={!message.trim() || isLoading}
                            data-testid="chatbot-send-button"
                            aria-label={t('sendMessage')}
                        >
                            <Send />
                        </IconButton>
                    </Box>

                    {/* AI Disclaimer */}
                    <Box
                        sx={{
                            px: 2,
                            pb: 1,
                            flexShrink: 0,
                            ...(isMobile && {
                                pb: 'max(env(safe-area-inset-bottom), 8px)',
                            }),
                        }}
                    >
                        <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{
                                fontSize: '0.6rem',
                                display: 'block',
                                textAlign: 'left',
                            }}
                        >
                            {t('disclaimer')}
                        </Typography>
                    </Box>
                </Paper>
            </Collapse>
        </>
    );
}
