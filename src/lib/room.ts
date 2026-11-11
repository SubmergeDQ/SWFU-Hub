const DISTRICTS: Record<string, string> = {
  '1': '松苑',
  '2': '竹苑',
  '3': '樟苑',
  '4': '茶苑',
  '5': '橡苑',
  '6': '秋海苑',
};

export interface RoomLabel {
  district: string;
  building: number;
  unit: number;
  floor: number;
  room: number;
  /** 秋海苑1栋1117号（11 楼 17 号） */
  text: string;
  /** 秋海苑1栋 */
  short: string;
}

/**
 * 学校用 8 位编号描述宿舍：
 * 片区(1) + 楼栋(2) + 单元(1) + 楼层(2) + 房间(2)，没有单元时第 4 位为 0。
 */
export function describeRoom(userCode: string): RoomLabel | null {
  const digits = (userCode || '').replace(/\D/g, '');
  if (digits.length !== 8) return null;

  const district = DISTRICTS[digits[0]];
  if (!district) return null;

  const building = Number(digits.slice(1, 3));
  const unit = Number(digits[3]);
  const floor = Number(digits.slice(4, 6));
  const room = Number(digits.slice(6, 8));
  if (!building || !floor || !room) return null;

  const unitPart = unit > 0 ? `${unit}单元` : '';
  const roomNumber = `${floor}${String(room).padStart(2, '0')}`;

  return {
    district,
    building,
    unit,
    floor,
    room,
    text: `${district}${building}栋${unitPart}${roomNumber}号`,
    short: `${district}${building}栋`,
  };
}
