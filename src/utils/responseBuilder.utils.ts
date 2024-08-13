import { NextFunction, Response } from "express";
import { RedisClient } from "./redis.utils";
import { createAuthorizationHeader } from "./auth.utils";
import axios from "axios";
import logger from "./logger.utils";
import { v4 } from "uuid";
import { getConfig } from "./config.utils";
import dotenv from "dotenv";

dotenv.config();

const redis = new RedisClient(12);

export async function responseBuilder(
    res: Response,
    next: NextFunction,
    reqContext: object,
    message: object,
    uri: string,
    action: string,
    error?: object | undefined
) {
    let ts = new Date();
    ts.setSeconds(ts.getSeconds() + 1);

    // JSON Data that will be send to BAP/BPP
    var async: { message: object; context?: object; error?: object } = {
        context: {},
        message,
    };


    if (action.startsWith("on_")) {
        // Request is from BAP
        async = {
            ...async,
            context: {
                ...reqContext,
                bpp_id: process.env.BPP_ID,
                bpp_uri: process.env.BPP_URI,
                timestamp: ts.toISOString(),
                action,
            },
        };
    } else {
        // Request is from BPP

        // const { bpp_uri, bpp_id, ...remainingContext } = reqContext as any;
        async = {
            ...async,
            context: {
                // ...remainingContext,
                ...reqContext,
                bap_id: process.env.BAP_ID,
                bap_uri: process.env.BAP_URI,
                timestamp: ts.toISOString(),
                message_id: v4(),
                action,
            },
        };
    }

    if (error) {
        async = { ...async, error };
    }

    const header = await createAuthorizationHeader(async);

    if (action.startsWith("on_")) {
        // Request is from BAP
        var requestLog: { [k: string]: any } = {
            request: async,
        };
        if (action === "on_status") {
            const transactionKeys = await redis.redis!.keys(
                `${(async.context! as any).transaction_id}-*`
            );
            const logIndex = transactionKeys.filter((e) =>
                e.includes("on_status-to-server")
            ).length;

            await redis.set(
                `${(async.context! as any).transaction_id
                }-${logIndex}-${action}-from-server`,
                JSON.stringify(requestLog)
            );
        } else {
            await redis.set(
                `${(async.context! as any).transaction_id}-${action}-from-server`,
                JSON.stringify(requestLog)
            );
        }
        try {
            const response = await axios.post(uri, async, {
                headers: {
                    authorization: header,
                },
            });

            requestLog.response = {
                timestamp: new Date().toISOString(),
                response: response.data,
            };

            await redis.set(
                `${(async.context! as any).transaction_id}-${action}-from-server`,
                JSON.stringify(requestLog)
            );
        } catch (error) {
            const response =
                axios.isAxiosError(error)
                    ? error?.response?.data
                    : {
                        message: {
                            ack: {
                                status: "NACK",
                            },
                        },
                        error: {
                            message: error,
                        },
                    };
            requestLog.response = {
                timestamp: new Date().toISOString(),
                response: response,
            };
            await redis.set(
                `${(async.context! as any).transaction_id}-${action}-from-server`,
                JSON.stringify(requestLog)
            );

            return next(error);
        }
    } else {
        var requestLog: { [k: string]: any } = {
            request: async,
        };
        try {
            const response = await axios.post(uri, async, {
                headers: {
                    authorization: header,
                },
            });

            requestLog.response = {
                timestamp: new Date().toISOString(),
                response: response.data,
            };

            await redis.set(
                `${(async.context! as any).transaction_id}-${action}-from-server`,
                JSON.stringify(requestLog)
            );
        } catch (error) {
            const response =
                axios.isAxiosError(error)
                    ? error?.response?.data
                    : {
                        message: {
                            ack: {
                                status: "NACK",
                            },
                        },
                        error: {
                            message: error,
                        },
                    };
            requestLog.response = {
                timestamp: new Date().toISOString(),
                response: response,
            };
            await redis.set(
                `${(async.context! as any).transaction_id}-${action}-from-server`,
                JSON.stringify(requestLog)
            );

            return next(error);
        }
    }

    logger.info({
        type: "response",
        action: action,
        transaction_id: (reqContext as any).transaction_id,
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