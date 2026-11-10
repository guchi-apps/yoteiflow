-- 活動記録と予定の紐づけ（#1514）
CREATE TABLE `ActivityEventLink` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `recordCalendarId` VARCHAR(191) NOT NULL,
    `recordEventId` VARCHAR(191) NOT NULL,
    `recordTitle` VARCHAR(191) NOT NULL,
    `recordStart` DATETIME(3) NOT NULL,
    `recordEnd` DATETIME(3) NOT NULL,
    `plannedCalendarId` VARCHAR(191) NOT NULL,
    `plannedEventId` VARCHAR(191) NOT NULL,
    `plannedTitle` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ActivityEventLink_userId_plannedEventId_idx`(`userId`, `plannedEventId`),
    UNIQUE INDEX `ActivityEventLink_userId_recordEventId_key`(`userId`, `recordEventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ActivityEventLink` ADD CONSTRAINT `ActivityEventLink_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
