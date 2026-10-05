-- 勤務先別の既定値と、勤務記録ごとの反映の指定（#1099）。
CREATE TABLE `WorkPlaceDefault` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `key` VARCHAR(191) NOT NULL,
  `isTrip` BOOLEAN NOT NULL DEFAULT false,
  `workEnabled` BOOLEAN NOT NULL DEFAULT true,
  `startMinutes` INTEGER NULL,
  `endMinutes` INTEGER NULL,
  `outboundEnabled` BOOLEAN NOT NULL DEFAULT true,
  `returnEnabled` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `WorkPlaceDefault_userId_key_isTrip_key`(`userId`, `key`, `isTrip`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `WorkRecordSetting` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `workRecordId` VARCHAR(191) NOT NULL,
  `settings` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `WorkRecordSetting_userId_workRecordId_key`(`userId`, `workRecordId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `WorkPlaceDefault` ADD CONSTRAINT `WorkPlaceDefault_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `WorkRecordSetting` ADD CONSTRAINT `WorkRecordSetting_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
