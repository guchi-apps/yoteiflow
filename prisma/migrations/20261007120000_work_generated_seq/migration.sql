-- 勤務記録の時間帯ごとの内訳（#1155）で、1日に勤務予定・移動が複数できるため、
-- 対応表のキーに同じ日・同じ種類の中の通し番号を足す。既存の行は seq=0 で従来と同じキーのまま。
ALTER TABLE `WorkGenerated` ADD COLUMN `seq` INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX `WorkGenerated_userId_workRecordId_date_kind_seq_key` ON `WorkGenerated`(`userId`, `workRecordId`, `date`, `kind`, `seq`);

DROP INDEX `WorkGenerated_userId_workRecordId_date_kind_key` ON `WorkGenerated`;
