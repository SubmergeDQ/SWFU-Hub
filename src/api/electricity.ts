import { postForm } from './client';
import type {
  ApiEnvelope,
  DailyUsage,
  DailyUsagePayload,
  MeterBind,
  MeterStatus,
  MonthUsage,
  WechatUser,
} from './types';
import { parseOpenId, type Account, type LinkedAccount } from '../store/account';
import { shiftDays, toDateString } from '../lib/date';

async function unwrap<T>(request: Promise<ApiEnvelope<T>>, fallback: string): Promise<T> {
  const response = await request;
  if (response.code !== 200 || response.data == null) {
    throw new Error(response.msg || fallback);
  }
  return response.data;
}

/** 用 openId 换微信身份、再取出该微信号绑定的全部电表 */
export async function connectAccount(input: string): Promise<LinkedAccount> {
  const openId = parseOpenId(input);
  if (!openId) {
    throw new Error('没有识别到 openId，请粘贴公众号里的整段链接');
  }

  const user = await unwrap(
    postForm<ApiEnvelope<WechatUser>>('/kddz/electricmeterpost/index', { openId }),
    '读取微信身份失败',
  );

  const binds = await unwrap(
    postForm<ApiEnvelope<MeterBind[]>>('/kddz/electricmeterpost/getBindListWx', {
      wechatUserId: user.wechatId,
    }),
    '读取绑定电表失败',
  );

  const meters = (binds || [])
    .filter((bind) => Boolean(bind && bind.bindMeterId))
    .map((bind) => ({
      meterId: bind.bindMeterId,
      userCode: bind.userCode,
      meterNo: bind.elemeterAddress || '',
      address: bind.userAddress || '',
      typeRemark: bind.elemeterTypeRemark || '',
    }));

  if (!meters.length) {
    throw new Error('这个微信号还没有绑定电表，请先在公众号里完成绑定');
  }

  return {
    openId,
    wechatId: user.wechatId,
    nickname: user.wechatUserNickname || '',
    avatar: user.wechatUserHeadimgurl || '',
    meters,
  };
}

/** 实时剩余电量、电价与电表状态 */
export async function fetchMeterStatus(account: Account): Promise<MeterStatus> {
  return unwrap(
    postForm<ApiEnvelope<MeterStatus>>('/kddz/electricmeterpost/electricMeterQuery', {
      wechatUserId: account.wechatId,
      electricUserUid: account.meterId,
      isAfterMoney: 0,
    }),
    '读取电表状态失败',
  );
}

/** 最近若干天的每日用电量 */
export async function fetchDailyUsage(meterId: string, days = 30): Promise<DailyUsage[]> {
  const end = new Date();
  const start = shiftDays(end, -days);
  const payload = await unwrap(
    postForm<ApiEnvelope<DailyUsagePayload>>('/kddz/electricmeterpost/GetMonthDayEleList', {
      startTime: toDateString(start),
      endTime: toDateString(end),
      meterid: meterId,
    }),
    '读取每日用电失败',
  );
  return payload?.data ?? [];
}

/** 最近若干个月的用电量与金额 */
export async function fetchMonthlyUsage(meterId: string, months = 6): Promise<MonthUsage[]> {
  const end = new Date();
  const start = shiftDays(end, -months * 30);
  const payload = await unwrap(
    postForm<ApiEnvelope<{ result: number; msg: string; data: MonthUsage[] }>>(
      '/kddz/electricmeterpost/GetMonthEleAndMoneyList',
      {
        startMonth: toDateString(start).slice(0, 8) + '01',
        endMonth: toDateString(end).slice(0, 8) + '01',
        meterid: meterId,
      },
    ),
    '读取月度用电失败',
  );
  return payload?.data ?? [];
}

/** 原系统的充值页，付款只能在微信内完成 */
export function buildRechargeUrl(account: Account): string {
  const query = `wechatUserOpenid=${encodeURIComponent(account.openId)}&meterId=${encodeURIComponent(account.meterId)}`;
  return `http://sdcz.swfu.edu.cn/refund/index.html#/pages/meterlist/meterpay?${query}`;
}
