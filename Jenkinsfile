pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '15'))
    }

    parameters {
        booleanParam(
            name: 'MANUAL_ROLLBACK',
            defaultValue: false,
            description: 'Check to roll back EC2 production directly to a previous image tag'
        )
        string(
            name: 'ROLLBACK_TAG',
            defaultValue: '',
            description: 'Optional target tag for manual rollback (leave blank to restore LAST_GOOD_TAG on EC2)'
        )
    }

    environment {
        REGISTRY_PREFIX = credentials('freshguard-registry-prefix')
        DOCKER_CREDS    = credentials('freshguard-registry-creds')
        EC2_HOST        = credentials('freshguard-ec2-host')
        EC2_USER        = credentials('freshguard-ec2-user')
        DEPLOY_DIR      = '/opt/freshguard-inventory'
        TRIVY_SEVERITY  = 'CRITICAL'
        DEPLOY_STARTED  = 'false'
    }

    stages {
        stage('1. Source-Code Checkout') {
            steps {
                checkout scm
                script {
                    env.GIT_COMMIT_SHORT = sh(
                        script: 'git rev-parse --short HEAD',
                        returnStdout: true
                    ).trim()
                    env.IMAGE_TAG = "${env.GIT_COMMIT_SHORT}-${env.BUILD_NUMBER}"
                    echo "Building FreshGuard tag: ${env.IMAGE_TAG}"
                }
            }
        }

        stage('Manual Rollback Shortcut') {
            when { expression { return params.MANUAL_ROLLBACK == true } }
            steps {
                sshagent(credentials: ['freshguard-ec2-ssh-key']) {
                    sh '''
                        ssh -o StrictHostKeyChecking=accept-new ${EC2_USER}@${EC2_HOST} \
                          "cd ${DEPLOY_DIR} && ./scripts/deploy.sh --rollback '${ROLLBACK_TAG}'"
                    '''
                }
            }
        }

        stage('2. Dependency Installation') {
            when { expression { return params.MANUAL_ROLLBACK == false } }
            steps {
                sh '''
                    cd backend && npm ci
                    cd ../frontend && npm ci
                    cd ../ml-service
                    if python3 -m venv .venv 2>/dev/null; then
                        . .venv/bin/activate && pip install -r requirements.txt
                    else
                        echo "python3-venv unavailable on host; Stage 6 will run ML tests via python:3.11-slim Docker container."
                        rm -rf .venv
                    fi
                '''
            }
        }

        stage('3. Secret & Security Checks') {
            when { expression { return params.MANUAL_ROLLBACK == false } }
            steps {
                sh '''
                    if command -v gitleaks >/dev/null 2>&1; then
                        gitleaks detect --source . --config .gitleaks.toml --no-git --exit-code 1
                    else
                        echo "Running fallback regex secret guard (install gitleaks on CI host for full scan)"
                        ! grep -rnE "AKIA[0-9A-Z]{16}|-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----|ghp_[A-Za-z0-9]{36}" \
                          backend/src frontend/src ml-service/app scripts Jenkinsfile
                    fi
                '''
            }
        }

        stage('4-6. Automated Testing (Backend, Frontend, ML)') {
            when { expression { return params.MANUAL_ROLLBACK == false } }
            parallel {
                stage('4. Backend Testing') {
                    steps {
                        sh 'cd backend && npm run lint && npm test'
                    }
                    post {
                        always {
                            archiveArtifacts artifacts: 'backend/coverage/**', allowEmptyArchive: true
                        }
                    }
                }
                stage('5. Frontend Testing') {
                    steps {
                        sh 'cd frontend && npm run lint && npm test && npm run build'
                    }
                    post {
                        always {
                            archiveArtifacts artifacts: 'frontend/coverage/**', allowEmptyArchive: true
                        }
                    }
                }
                stage('6. ML-Service Testing') {
                    steps {
                        sh '''
                            cd ml-service
                            if [ -x .venv/bin/pytest ]; then
                                . .venv/bin/activate && pytest --cov=app --cov-report=xml:coverage.xml
                            else
                                docker run --rm -v "$PWD:/app" -w /app python:3.11-slim sh -c \
                                  "pip install --no-cache-dir -q -r requirements.txt && pytest --cov=app --cov-report=xml:coverage.xml && chown -R $(id -u):$(id -g) /app"
                            fi
                        '''
                    }
                    post {
                        always {
                            archiveArtifacts artifacts: 'ml-service/coverage.xml', allowEmptyArchive: true
                        }
                    }
                }
            }
        }

        

        
    }

    post {
        failure {
            script {
                if (params.MANUAL_ROLLBACK == false && env.DEPLOY_STARTED == 'true') {
                    echo '17. Automated Rollback triggered due to deployment failure!'
                    try {
                        sshagent(credentials: ['freshguard-ec2-ssh-key']) {
                            sh '''
                                ssh -o StrictHostKeyChecking=accept-new ${EC2_USER}@${EC2_HOST} \
                                  "cd ${DEPLOY_DIR} && ./scripts/deploy.sh --rollback" || true
                            '''
                        }
                    } catch (err) {
                        echo "Automated rollback skipped or failed: ${err.message}"
                    }
                }
            }
        }
    }
}
