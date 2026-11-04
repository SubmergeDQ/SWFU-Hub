export interface ApiEnvelope<T> {
  code: number;
  msg: string;
  data: T;
}

export interface WechatUser {
  wechatId: string;
  wechatUserOpenid: string;
  wechatUserNickname: string;
  wechatUserHeadimgurl: string;
}

export interface MeterBind {
  bindId: number;
  bindMeterId: string;
  bindMeterCode: string;
  userCode: string;
  userName: string;
  userAddress: string;
  userBalance: string;
  elemeterAddress: string;
  elemeterTypeRemark: string;
}

export interface MeterStatus {
  shengyu: string;
  leiji: string;
  price: string;
  zhuangtai: string;
  querycode: string;
  querymsg: string;
}

export interface DailyUsage {
  total: string;
  endtime: string;
  starttime: string;
}

export interface DailyUsagePayload {
  result: number;
  msg: string;
  data: DailyUsage[];
}

export interface MonthUsage {
  total: string;
  money: string;
  month: string;
}
