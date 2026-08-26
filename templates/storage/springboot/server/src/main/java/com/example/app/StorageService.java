package com.example.app;

import java.net.URI;
import java.time.Duration;
import java.util.List;
import java.util.Map;

import jakarta.annotation.PostConstruct;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.CreateBucketRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadBucketRequest;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Request;
import software.amazon.awssdk.services.s3.model.NoSuchBucketException;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;

/**
 * The S3 client, and the bucket it expects to find. S3 here is the protocol:
 * the same code reaches MinIO, Cloudflare R2 or S3 itself, and which one is
 * decided by S3_ENDPOINT in .env. Credentials come from AWS_ACCESS_KEY_ID and
 * AWS_SECRET_ACCESS_KEY, which the SDK reads without being told to.
 */
@Service
public class StorageService {

    private final String bucket;
    private final S3Client s3;
    private final S3Presigner presigner;

    public StorageService(
            @Value("${S3_BUCKET:__BUCKET_NAME__}") String bucket,
            @Value("${S3_ENDPOINT:}") String endpoint,
            @Value("${AWS_REGION:us-east-1}") String region) {
        this.bucket = bucket;

        S3ClientBuilderPair built = build(endpoint, region);
        this.s3 = built.client();
        this.presigner = built.presigner();
    }

    private record S3ClientBuilderPair(S3Client client, S3Presigner presigner) {
    }

    private static S3ClientBuilderPair build(String endpoint, String region) {
        Region parsed = Region.of(region);
        if (endpoint == null || endpoint.isBlank()) {
            return new S3ClientBuilderPair(
                    S3Client.builder().region(parsed).build(),
                    S3Presigner.builder().region(parsed).build());
        }

        // MinIO addresses a bucket as a path, where AWS uses a subdomain.
        URI uri = URI.create(endpoint);
        S3Configuration pathStyle = S3Configuration.builder().pathStyleAccessEnabled(true).build();
        return new S3ClientBuilderPair(
                S3Client.builder().region(parsed).endpointOverride(uri).serviceConfiguration(pathStyle).build(),
                S3Presigner.builder().region(parsed).endpointOverride(uri).serviceConfiguration(pathStyle).build());
    }

    /**
     * Creates the bucket unless it is already there, the way JPA creates its
     * tables on startup. The retries are for the seconds after
     * `npm run docker:up` in which MinIO is running but not yet answering.
     */
    @PostConstruct
    void ensureBucket() {
        for (int attempt = 1; attempt <= 5; attempt++) {
            try {
                s3.headBucket(HeadBucketRequest.builder().bucket(bucket).build());
                return;
            } catch (NoSuchBucketException missing) {
                s3.createBucket(CreateBucketRequest.builder().bucket(bucket).build());
                return;
            } catch (RuntimeException notYet) {
                // Not every store maps a missing bucket to NoSuchBucketException;
                // a bare 404 means the same thing.
                if (notYet instanceof S3Exception s3Error && s3Error.statusCode() == 404) {
                    s3.createBucket(CreateBucketRequest.builder().bucket(bucket).build());
                    return;
                }
                if (attempt == 5) {
                    throw notYet;
                }
                try {
                    Thread.sleep(1000);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
        }
    }

    public String put(String key, MultipartFile file) throws java.io.IOException {
        s3.putObject(
                PutObjectRequest.builder()
                        .bucket(bucket)
                        .key(key)
                        .contentType(file.getContentType())
                        .build(),
                RequestBody.fromBytes(file.getBytes()));
        return key;
    }

    public List<Map<String, Object>> list() {
        return s3.listObjectsV2(ListObjectsV2Request.builder().bucket(bucket).build()).contents()
                .stream()
                .map(object -> Map.<String, Object>of(
                        "key", object.key(),
                        "size", object.size(),
                        "updatedAt", object.lastModified().toString()))
                .toList();
    }

    /** A link straight to the store, good for an hour. */
    public URI presign(String key) {
        String url = presigner.presignGetObject(
                GetObjectPresignRequest.builder()
                        .signatureDuration(Duration.ofHours(1))
                        .getObjectRequest(GetObjectRequest.builder().bucket(bucket).key(key).build())
                        .build())
                .url()
                .toString();
        return URI.create(url);
    }
}
