import { RedisClient } from '../../src/utils/redis.utils';
import { buildContext, generateTimestamp, logAndStoreRequest, makeRequest } from '../../src/utils/responseBuilder.utils';
import axios from 'axios';


jest.mock('axios');
jest.mock('../../src/utils/redis.utils');

describe('responseBuilder', () => {
    it('should generate a timestamp in the future', async () => {
        const ts = await generateTimestamp();
        expect(new Date(ts).getTime()).toBeGreaterThan(Date.now());
    });

    it('should build context for BAP', () => {
        const context = buildContext({ transaction_id: '123' }, 'search', true);
        expect(context).toHaveProperty('bap_id', process.env.BAP_ID);
        expect(context).toHaveProperty('bap_uri', process.env.BAP_URI);
    });

    it('should build context for BPP', () => {
        const context = buildContext({ transaction_id: '123' }, 'on_search', false);
        expect(context).toHaveProperty('bpp_id', process.env.BPP_ID);
        expect(context).toHaveProperty('bpp_uri', process.env.BPP_URI);
    });

    it('should store log in Redis', async () => {
        const logData = { key: 'value' };
        await logAndStoreRequest('test-key', logData);
        expect(RedisClient).toHaveBeenCalled();
    });

    it('should make a request with the correct header', async () => {
        axios.post = jest.fn().mockResolvedValue({data: 'response'});
        const response = await makeRequest('http://test.com', { key: 'value' }, 'Bearer token');
        expect(axios.post).toHaveBeenCalledWith('http://test.com', { key: 'value' }, { headers: { authorization: 'Bearer token' } });
        expect(response.data).toBe('response');
    });
});
