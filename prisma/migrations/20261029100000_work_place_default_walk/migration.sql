-- 勤務場所ごとの、Yahoo!取り込みで電車の前後に足す徒歩の分（#1471）。null は共通値を使う。
ALTER TABLE `WorkPlaceDefault` ADD COLUMN `walkHomeMinutes` INTEGER NULL,
    ADD COLUMN `walkPlaceMinutes` INTEGER NULL;
