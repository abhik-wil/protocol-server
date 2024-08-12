import { NextFunction, Response } from "express";
import { RedisClient } from "./redis.utils";
import { createAuthorizationHeader } from "./auth.utils";
import axios from "axios";
import logger from "./logger.utils";
import { v4 } from "uuid";
import { getConfig } from "./config.utils";

const redis = new RedisClient(25);

export async function responseBuilder(
    res: Response,
    next: NextFunction,
    reqContext: object,
    message: object,
    uri: string,
    action: string,
    domain:
        | "b2b"
        | "b2c"
        | "services"
        | "agri-services"
        | "healthcare-service"
        | "agri-equipment-hiring",
    error?: object | undefined
) {
    res.locals = {};
    let ts = new Date();
    ts.setSeconds(ts.getSeconds() + 1);

    var async: { message: object; context?: object; error?: object } = {
        context: {},
        message,
    };

    // const bppURI =
    // 	domain === "b2b"
    // 		? B2B_BPP_MOCKSERVER_URL
    // 		: domain === "agri-services"
    // 		? AGRI_SERVICES_BPP_MOCKSERVER_URL
    // 		: domain === "healthcare-service"
    // 		? HEALTHCARE_SERVICES_BPP_MOCKSERVER_URL
    // 		: domain === "agri-equipment-hiring"
    // 		? AGRI_EQUIPMENT_BPP_MOCKSERVER_URL
    // 		:domain === "b2c"? B2C_BPP_MOCKSERVER_URL
    // 		: SERVICES_BPP_MOCKSERVER_URL;

    const PORT: number = getConfig().server.port;
    const bppURI = domain === "b2b" ? `http://localhost:${PORT}/api/b2b/bpp` : domain === "b2c" ? `http://localhost:${PORT}/api/b2c/bpp`: `http://localhost:${PORT}`;

    if (action.startsWith("on_")) {
        async = {
            ...async,
            context: {
                ...reqContext,
                bpp_id: "mock.ondc.org/api",
                bpp_uri: bppURI,
                timestamp: ts.toISOString(),
                action,
            },
        };
    } else {
        // const { bpp_uri, bpp_id, ...remainingContext } = reqContext as any;
        async = {
            ...async,
            context: {
                // ...remainingContext,
                ...reqContext,
                bap_id: "mock.ondc.org/api",
                bap_uri: bppURI,
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
        var log: { [k: string]: any } = {
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
                JSON.stringify(log)
            );
        } else {
            await redis.set(
                `${(async.context! as any).transaction_id}-${action}-from-server`,
                JSON.stringify(log)
            );
        }
        try {
            const response = await axios.post(uri, async, {
                headers: {
                    authorization: header,
                },
            });

            log.response = {
                timestamp: new Date().toISOString(),
                response: response.data,
            };

            await redis.set(
                `${(async.context! as any).transaction_id}-${action}-from-server`,
                JSON.stringify(log)
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
            log.response = {
                timestamp: new Date().toISOString(),
                response: response,
            };
            await redis.set(
                `${(async.context! as any).transaction_id}-${action}-from-server`,
                JSON.stringify(log)
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