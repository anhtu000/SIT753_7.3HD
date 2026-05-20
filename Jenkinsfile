pipeline {
    agent any

    tools {
        nodejs 'NodeJS20'
    }

    environment {
        APP_NAME = 'flow-retail'
        IMAGE_NAME = 'flow-retail'
        DOCKER_NETWORK = 'flow-net'
        STAGING_CONTAINER = 'flow-staging'
        PROD_CONTAINER = 'flow-prod'
        PROMETHEUS_CONTAINER = 'flow-prometheus'
        ALERTMANAGER_CONTAINER = 'flow-alertmanager'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
                sh 'node --version'
                sh 'npm --version'
            }
        }

        stage('Install Dependencies') {
            steps {
                sh 'npm ci'
            }
        }

        stage('Build') {
            steps {
                sh '''
                    npm run init-db
                    docker build -t $IMAGE_NAME:$BUILD_NUMBER .
                    docker tag $IMAGE_NAME:$BUILD_NUMBER $IMAGE_NAME:latest

                    mkdir -p artifacts
                    docker save $IMAGE_NAME:$BUILD_NUMBER | gzip > artifacts/$IMAGE_NAME-$BUILD_NUMBER.tar.gz
                '''
            }
            post {
                always {
                    archiveArtifacts artifacts: 'artifacts/*.tar.gz', fingerprint: true
                }
            }
        }

        stage('Test') {
            environment {
                NODE_ENV = 'test'
                SKIP_EMAIL = 'true'
                SESSION_SECRET = 'jenkins-test-session-secret'
                STRIPE_SECRET_KEY = 'sk_test_dummy_for_tests'
            }
            steps {
                sh '''
                    npm run init-db
                    npm test
                '''
            }
            post {
                always {
                    junit allowEmptyResults: true, testResults: 'reports/junit/*.xml'
                    archiveArtifacts allowEmptyArchive: true, artifacts: 'coverage/**,reports/**'
                }
            }
        }

        stage('Code Quality') {
            steps {
                withCredentials([string(credentialsId: 'SONAR_TOKEN', variable: 'SONAR_TOKEN')]) {
                    sh '''
                        docker run --rm \
                          -e SONAR_HOST_URL="https://sonarcloud.io" \
                          -e SONAR_TOKEN="$SONAR_TOKEN" \
                          -v "$PWD:/usr/src" \
                          sonarsource/sonar-scanner-cli:latest
                    '''
                }
            }
        }

        stage('Security') {
            steps {
                sh '''
                    mkdir -p reports/security

                    docker run --rm \
                      -v "$PWD:/src" \
                      aquasec/trivy:latest fs \
                      --severity LOW,MEDIUM,HIGH,CRITICAL \
                      --format table \
                      --output /src/reports/security/trivy-fs.txt \
                      /src || true

                    docker run --rm \
                      -v /var/run/docker.sock:/var/run/docker.sock \
                      -v "$PWD:/src" \
                      aquasec/trivy:latest image \
                      --severity LOW,MEDIUM,HIGH,CRITICAL \
                      --format table \
                      --output /src/reports/security/trivy-image.txt \
                      $IMAGE_NAME:$BUILD_NUMBER || true

                    npm audit --audit-level=high > reports/security/npm-audit.txt || true
                '''
            }
            post {
                always {
                    archiveArtifacts allowEmptyArchive: true, artifacts: 'reports/security/**'
                }
            }
        }

        stage('Deploy to Staging') {
            steps {
                withCredentials([
                    string(credentialsId: 'STRIPE_SECRET_KEY', variable: 'STRIPE_SECRET_KEY'),
                    string(credentialsId: 'SESSION_SECRET', variable: 'SESSION_SECRET'),
                    usernamePassword(credentialsId: 'GMAIL_SMTP', usernameVariable: 'EMAIL_USER', passwordVariable: 'EMAIL_PASS')
                ]) {
                    sh '''
                        docker network create $DOCKER_NETWORK || true

                        docker rm -f $STAGING_CONTAINER || true

                        docker run -d \
                          --name $STAGING_CONTAINER \
                          --network $DOCKER_NETWORK \
                          -p 3001:3000 \
                          -e NODE_ENV=staging \
                          -e PORT=3000 \
                          -e STRIPE_SECRET_KEY="$STRIPE_SECRET_KEY" \
                          -e SESSION_SECRET="$SESSION_SECRET" \
                          -e EMAIL_USER="$EMAIL_USER" \
                          -e EMAIL_PASS="$EMAIL_PASS" \
                          -e SKIP_EMAIL=true \
                          $IMAGE_NAME:$BUILD_NUMBER

                        sleep 8
                        curl -f http://localhost:3001/health
                    '''
                }
            }
        }

        stage('Release to Production') {
            steps {
                withCredentials([
                    string(credentialsId: 'STRIPE_SECRET_KEY', variable: 'STRIPE_SECRET_KEY'),
                    string(credentialsId: 'SESSION_SECRET', variable: 'SESSION_SECRET'),
                    usernamePassword(credentialsId: 'GMAIL_SMTP', usernameVariable: 'EMAIL_USER', passwordVariable: 'EMAIL_PASS')
                ]) {
                    sh '''
                        docker tag $IMAGE_NAME:$BUILD_NUMBER $IMAGE_NAME:prod-$BUILD_NUMBER
                        docker tag $IMAGE_NAME:$BUILD_NUMBER $IMAGE_NAME:production

                        docker rm -f $PROD_CONTAINER || true

                        docker run -d \
                          --name $PROD_CONTAINER \
                          --network $DOCKER_NETWORK \
                          -p 3002:3000 \
                          -e NODE_ENV=production \
                          -e PORT=3000 \
                          -e STRIPE_SECRET_KEY="$STRIPE_SECRET_KEY" \
                          -e SESSION_SECRET="$SESSION_SECRET" \
                          -e EMAIL_USER="$EMAIL_USER" \
                          -e EMAIL_PASS="$EMAIL_PASS" \
                          -e SKIP_EMAIL=true \
                          $IMAGE_NAME:prod-$BUILD_NUMBER

                        sleep 8
                        curl -f http://localhost:3002/health
                    '''
                }
            }
        }

        stage('Monitoring and Alerting') {
            steps {
                sh '''
                    docker rm -f $PROMETHEUS_CONTAINER $ALERTMANAGER_CONTAINER || true

                    docker run -d \
                      --name $ALERTMANAGER_CONTAINER \
                      --network $DOCKER_NETWORK \
                      -p 9093:9093 \
                      -v "$PWD/monitoring/alertmanager.yml:/etc/alertmanager/alertmanager.yml" \
                      prom/alertmanager:latest

                    docker run -d \
                      --name $PROMETHEUS_CONTAINER \
                      --network $DOCKER_NETWORK \
                      -p 9090:9090 \
                      -v "$PWD/monitoring/prometheus.yml:/etc/prometheus/prometheus.yml" \
                      -v "$PWD/monitoring/alert-rules.yml:/etc/prometheus/alert-rules.yml" \
                      prom/prometheus:latest

                    sleep 10

                    curl -f http://localhost:9090/-/healthy
                    curl -f http://localhost:3002/metrics | head
                '''
            }
        }
    }

    post {
        always {
            echo 'Pipeline completed. Check Jenkins stage view, artifacts, SonarCloud, Trivy reports, staging app, production app, and Prometheus.'
        }
        success {
            echo 'SUCCESS: Build, Test, Code Quality, Security, Deploy, Release, and Monitoring completed.'
        }
        failure {
            echo 'FAILED: Check the failed Jenkins stage log.'
        }
    }
}