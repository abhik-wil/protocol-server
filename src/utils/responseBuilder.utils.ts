import { Response, NextFunction } from 'express';
import axios from 'axios';
import { v4 } from 'uuid';
import logger from './logger.utils';
import { createAuthorizationHeader } from './auth.utils'; // Assuming this function exists
import { RedisClient } from './redis.utils';


let redis = new RedisClient(12);

export async function generateTimestamp(): Promise<string> {
    let ts = new Date();
    ts.setSeconds(ts.getSeconds() + 1);
    return ts.toISOString();
}

export function buildContext(reqContext: object, action: string, isBAP: boolean): object {
    const baseContext = {
        ...reqContext,
        timestamp: generateTimestamp(),
        action,
    };

    if (isBAP) {
        return {
            ...baseContext,
            bap_id: process.env.BAP_ID,
            bap_uri: process.env.BAP_URI,
            message_id: v4(),
        };
    } else {
        return {
            ...baseContext,
            bpp_id: process.env.BPP_ID,
            bpp_uri: process.env.BPP_URI,
        };
    }
}

export async function logAndStoreRequest(key: string, requestLog: object): Promise<void> {
    await redis.set(key, JSON.stringify(requestLog));
}

export async function makeRequest(uri: string, asyncData: object, header: string) {
    return axios.post(uri, asyncData, {
        headers: {
            authorization: header,
        },
    });
}

export async function responseBuilder(
    res: Response,
    next: NextFunction,
    reqContext: object,
    message: object,
    uri: string,
    action: string,
    error?: object | undefined
) {
    let async: { message: object; context?: object; error?: object } = {
        context: {},
        message,
    };

    const isBAP = !action.startsWith("on_");
    async.context = buildContext(reqContext, action, isBAP);

    if (error) {
        async.error = error;
    }

    const header = await createAuthorizationHeader(async);
    const transactionId = (reqContext as any).transaction_id;

    let requestLog: { [k: string]: any } = {
        request: async,
    };

    try {
        const response = await makeRequest(uri, async, header);
        requestLog.response = {
            timestamp: new Date().toISOString(),
            response: response.data,
        };
    } catch (error) {
        requestLog.response = {
            timestamp: new Date().toISOString(),
            response: axios.isAxiosError(error) ? error?.response?.data : {
                message: { ack: { status: "NACK" } },
                error: { message: error },
            },
        };
        return next(error);
    }

    const logKey = `${transactionId}-${action}-from-server`;
    await logAndStoreRequest(logKey, requestLog);

    logger.info({
        type: "response",
        action: action,
        transaction_id: transactionId,
        message: { sync: { message: { ack: { status: "ACK" } } } },
    });

    return res.json({
        message: {
            ack: {
                status: "ACK",
            },
        },
    });
}
